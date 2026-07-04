// AiProvider 实现：本机 `claude` CLI 子进程（免 Key 模式，见 docs/SPEC.md §11）。
// 关键点：
//   - Electron GUI 进程继承的 PATH 通常不含 /usr/local/bin、/opt/homebrew/bin、~/.local/bin，
//     必须显式拼接，否则 spawn('claude', ...) 会直接 ENOENT。
//   - prompt 一律通过 spawn 的参数数组传递，不拼接进 shell 字符串，天然免转义。
//   - --output-format json 后从 stdout 解析 `.result` 字段拿到模型输出的纯文本。
import { spawn } from 'node:child_process';
import os from 'node:os';
import { resolveUserDataDir } from '../paths';
import type { ProviderTestResult } from '../../shared/types';
import type { AiProvider } from './index';

const EXTRA_PATHS = ['/usr/local/bin', '/opt/homebrew/bin', `${os.homedir()}/.local/bin`];
const SYSTEM_PROMPT = '你是一位严谨的工作汇报助手';
const CHAT_TIMEOUT_MS = 180_000;
const VISION_TIMEOUT_MS = 90_000;
const AVAILABILITY_TIMEOUT_MS = 5_000;
const TEST_TIMEOUT_MS = 30_000;

function buildEnv(): NodeJS.ProcessEnv {
  const existing = (process.env.PATH ?? '').split(':').filter(Boolean);
  const merged = [...new Set([...existing, ...EXTRA_PATHS])].join(':');
  return { ...process.env, PATH: merged };
}

/** claude CLI 的 --model 只接受别名（sonnet/opus/haiku）或完整模型名；把 API 风格的完整模型 id 粗略映射为别名。 */
export function toCliModelAlias(modelId: string): string {
  const lower = modelId.toLowerCase();
  if (lower.includes('opus')) return 'opus';
  if (lower.includes('haiku')) return 'haiku';
  if (lower.includes('sonnet')) return 'sonnet';
  return modelId; // 用户可能已经直接填了别名，原样透传
}

export function isClaudeCliAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    // stdin 用 'ignore'（等价于 `< /dev/null`）：claude CLI 在 -p 模式下若发现 stdin 是未关闭的管道会等待其数据，
    // 白等约 3s 甚至以非零码退出。GUI 主进程 spawn 默认给子进程一个空管道 stdin，必须显式忽略，否则调用不稳定。
    const child = spawn('claude', ['--version'], { env: buildEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      resolve(false);
    }, AVAILABILITY_TIMEOUT_MS);
    child.on('error', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(false);
    });
    child.on('exit', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(code === 0);
    });
  });
}

function runClaude(args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false;
    // stdin 用 'ignore'（等价于 `< /dev/null`）：见 isClaudeCliAvailable 处说明。大 prompt 时尤其关键——
    // 否则 claude 会因等待未关闭的 stdin 管道而输出 “no stdin data received in 3s” 并以退出码 1 失败。
    // cwd 固定到本 App 的数据目录：claude CLI 会加载 cwd 所在项目的 CLAUDE.md 等上下文，
    // 若继承 Electron 进程的 cwd（dev 下是任意项目目录），会把无关项目上下文混进报告生成。
    const child = spawn('claude', args, { env: buildEnv(), cwd: resolveUserDataDir(), stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(new Error(`claude CLI 超时（超过 ${Math.round(timeoutMs / 1000)}s 未返回）`));
    }, timeoutMs);
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf-8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf-8');
    });
    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`claude CLI 退出码 ${code}：${(stderr || stdout).trim().slice(0, 500) || '未知错误'}`));
        return;
      }
      resolve(stdout);
    });
  });
}

interface ClaudeCliJsonResult {
  result?: string;
  is_error?: boolean;
  error?: string;
  subtype?: string;
}

function extractResult(stdout: string): string {
  let parsed: ClaudeCliJsonResult;
  try {
    parsed = JSON.parse(stdout) as ClaudeCliJsonResult;
  } catch {
    // 容错：偶尔 stdout 前面会混入非 JSON 的告警行，截取第一个花括号块再试一次。
    const match = stdout.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('claude CLI 输出不是合法 JSON');
    parsed = JSON.parse(match[0]) as ClaudeCliJsonResult;
  }
  if (parsed.is_error) {
    throw new Error(parsed.error ?? `claude CLI 返回错误（${parsed.subtype ?? 'unknown'}）`);
  }
  if (typeof parsed.result !== 'string') {
    throw new Error('claude CLI 输出缺少 result 字段');
  }
  return parsed.result;
}

export function createClaudeCliProvider(model: string, visionModel: string): AiProvider {
  const cliVisionModel = toCliModelAlias(visionModel);

  return {
    async chat(prompt: string): Promise<string> {
      const args = ['-p', prompt, '--output-format', 'json', '--model', model, '--system-prompt', SYSTEM_PROMPT];
      const stdout = await runClaude(args, CHAT_TIMEOUT_MS);
      return extractResult(stdout);
    },

    async analyzeImage(imagePath: string, prompt: string): Promise<string> {
      const fullPrompt = `请先使用 Read 工具读取这张图片：${imagePath}\n\n然后完成以下任务：\n${prompt}`;
      const args = ['-p', fullPrompt, '--output-format', 'json', '--allowedTools', 'Read', '--model', cliVisionModel];
      const stdout = await runClaude(args, VISION_TIMEOUT_MS);
      return extractResult(stdout);
    },

    async test(): Promise<ProviderTestResult> {
      const start = Date.now();
      const available = await isClaudeCliAvailable();
      if (!available) {
        return { ok: false, message: '未检测到 claude 命令，请确认已安装并登录 Claude Code CLI（claude auth）。' };
      }
      try {
        const stdout = await runClaude(['-p', '回复ok', '--output-format', 'json', '--model', 'haiku'], TEST_TIMEOUT_MS);
        const result = extractResult(stdout);
        return { ok: true, message: `连接成功：${result.trim().slice(0, 60)}`, latencyMs: Date.now() - start };
      } catch (err) {
        return { ok: false, message: humanizeCliError(err) };
      }
    },
  };
}

function humanizeCliError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/超时/.test(msg)) return '响应超时，请稍后重试。';
  if (/ENOENT/.test(msg)) return '未检测到 claude 命令，请确认已安装并登录 Claude Code CLI。';
  return msg;
}
