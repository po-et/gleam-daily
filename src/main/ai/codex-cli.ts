// AiProvider 实现：本机 `codex` CLI 子进程（免 Key 模式，v1.1 新增，见 docs/SPEC.md §11）。
// 关键点（与 claude-cli.ts 同源的坑 + codex 特有约定）：
//   - Electron GUI 进程继承的 PATH 通常不含 /usr/local/bin、/opt/homebrew/bin、~/.local/bin，
//     codex 还可能装在 ~/.codex/bin，全部显式拼接，否则 spawn('codex', ...) 直接 ENOENT。
//   - 最终回复只从 `-o <临时文件>` 读取：codex 的 stdout 是思考过程/运行日志（含 session 头、token 统计等），
//     不做解析。临时文件放 os.tmpdir()、随机名，finally 里删除；文件为空/不存在即视为失败并附 stderr 摘要。
//   - vision 用 `--image=<绝对路径>`（必须等号形式）：`-i/--image` 是变长参数，空格形式会把后面的 prompt
//     也吞成第二个图片路径，导致「文件不存在」类报错。
//   - `--ignore-user-config` 必须带：隔离用户全局 config/hooks，省 token 且避免副作用；auth（登录态）不受影响。
//   - `-s read-only` + `--skip-git-repo-check` + `--ephemeral`：只读沙箱、不校验 git 仓库、一次性会话不落历史。
//   - cwd 固定到本 App 的数据目录（同 claude-cli 的理由）：避免把 Electron 进程当前工作目录的项目上下文混入。
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveUserDataDir } from '../paths';
import type { ProviderTestResult } from '../../shared/types';
import type { AiProvider } from './index';

const EXTRA_PATHS = ['/usr/local/bin', '/opt/homebrew/bin', `${os.homedir()}/.local/bin`, `${os.homedir()}/.codex/bin`];
const CHAT_TIMEOUT_MS = 300_000; // 文本 300s
const VISION_TIMEOUT_MS = 180_000; // 视觉 180s
const TEST_TIMEOUT_MS = 120_000; // 连通性测试 120s
const AVAILABILITY_TIMEOUT_MS = 5_000;

function buildEnv(): NodeJS.ProcessEnv {
  const existing = (process.env.PATH ?? '').split(':').filter(Boolean);
  const merged = [...new Set([...existing, ...EXTRA_PATHS])].join(':');
  return { ...process.env, PATH: merged };
}

export function isCodexCliAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    // stdin 'ignore'：codex exec 在非 TTY 下会尝试从 stdin 读补充输入，给它 /dev/null 等价物立即 EOF，避免白等。
    const child = spawn('codex', ['--version'], { env: buildEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
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

interface CodexRunResult {
  code: number | null;
  stderr: string;
}

/** 低层 spawn 封装：只负责跑进程、收 stderr、处理超时/ENOENT，不读结果文件。resolve 时带回 code 与 stderr。 */
function spawnCodex(args: string[], timeoutMs: number): Promise<CodexRunResult> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const child = spawn('codex', args, { env: buildEnv(), cwd: resolveUserDataDir(), stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(new Error(`codex CLI 超时（超过 ${Math.round(timeoutMs / 1000)}s 未返回）`));
    }, timeoutMs);
    // stdout 是思考/日志，不解析，但仍需消费掉，避免管道缓冲写满阻塞子进程。
    child.stdout.on('data', () => {});
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
      resolve({ code, stderr });
    });
  });
}

/** 从 stderr 里摘出对用户有意义的片段：滤掉大量「failed to load skill」噪声行，取尾部若干字符。 */
function summarizeStderr(stderr: string): string {
  const cleaned = stderr
    .split('\n')
    .filter((line) => line.trim() && !/failed to load skill/i.test(line))
    .join('\n')
    .trim();
  return cleaned.slice(-500);
}

/**
 * 跑一次 codex exec 并从 `-o` 临时文件取最终回复。
 * 成功判据：进程正常结束（或即便非零码但产出了非空结果文件）→ 用文件内容；
 * 文件为空/不存在 → 失败，附 stderr 摘要（登录失效、模型不可用等都会落在这里）。
 */
async function runCodex(extraArgs: string[], timeoutMs: number): Promise<string> {
  const outFile = path.join(os.tmpdir(), `gleam-codex-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`);
  const args = [
    'exec',
    '--skip-git-repo-check',
    '--ignore-user-config',
    '--ephemeral',
    '-s',
    'read-only',
    '--color',
    'never',
    '-o',
    outFile,
    ...extraArgs,
  ];
  try {
    const { code, stderr } = await spawnCodex(args, timeoutMs);
    let content = '';
    try {
      content = await fs.promises.readFile(outFile, 'utf-8');
    } catch {
      content = '';
    }
    const trimmed = content.trim();
    if (trimmed) return trimmed; // 只要拿到非空回复就算成功，忽略退出码
    const summary = summarizeStderr(stderr);
    throw new Error(`codex CLI 未产出结果（退出码 ${code ?? '未知'}）：${summary || '无输出'}`);
  } finally {
    await fs.promises.unlink(outFile).catch(() => {});
  }
}

export function createCodexCliProvider(model: string): AiProvider {
  const modelArgs = model.trim() ? ['-m', model.trim()] : []; // 留空则用 codex 内置默认模型（如 gpt-5.5）

  return {
    async chat(prompt: string): Promise<string> {
      return runCodex([...modelArgs, prompt], CHAT_TIMEOUT_MS);
    },

    async analyzeImage(imagePath: string, prompt: string): Promise<string> {
      // 视觉与文本共用 codexCli.model（忽略 visionModel）。--image 必须等号形式，见文件头注释。
      return runCodex([`--image=${imagePath}`, ...modelArgs, prompt], VISION_TIMEOUT_MS);
    },

    async test(): Promise<ProviderTestResult> {
      const start = Date.now();
      const available = await isCodexCliAvailable();
      if (!available) {
        return { ok: false, message: '未检测到 codex 命令，请确认已安装并登录 Codex CLI（codex login）。' };
      }
      try {
        const result = await runCodex([...modelArgs, '只回复两个字：正常'], TEST_TIMEOUT_MS);
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
  if (/ENOENT/.test(msg)) return '未检测到 codex 命令，请确认已安装 Codex CLI。';
  // codex 未登录/鉴权失效时 stderr 常见 not logged in / login / unauthorized / auth / credential 等提示，转述为人话。
  if (/not logged in|please (run )?login|unauthor|401|credential|auth/i.test(msg)) {
    return 'Codex CLI 未登录或登录已失效，请在终端运行 codex login 后重试。';
  }
  return msg;
}
