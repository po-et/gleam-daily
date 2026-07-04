// Provider 工厂：根据 Settings.ai.provider 构造对应的 AiProvider 实现。见 docs/SPEC.md §11。
import type { Settings } from '../../shared/types';
import { getDecryptedSecret } from '../settings';
import { createAnthropicProvider } from './anthropic';
import { createClaudeCliProvider, isClaudeCliAvailable } from './claude-cli';
import { createCodexCliProvider, isCodexCliAvailable } from './codex-cli';
import { createOpenAiCompatProvider } from './openai-compat';

export interface AiProvider {
  chat(prompt: string, opts?: { maxTokens?: number }): Promise<string>;
  analyzeImage(imagePath: string, prompt: string): Promise<string>;
  test(): Promise<import('../../shared/types').ProviderTestResult>;
}

export { isClaudeCliAvailable, isCodexCliAvailable };

/** 根据当前设置构造一个可用的 AiProvider 实例。文本模型与 vision 模型可以不同（各 provider 内部自行区分）。 */
export function getProvider(settings: Settings): AiProvider {
  switch (settings.ai.provider) {
    case 'claude-cli':
      return createClaudeCliProvider(settings.ai.claudeCli.model, settings.ai.visionModel);
    case 'codex-cli':
      // 文本与视觉共用 codexCli.model（忽略 visionModel），故只透传一个模型参数。
      return createCodexCliProvider(settings.ai.codexCli.model);
    case 'anthropic':
      return createAnthropicProvider(getDecryptedSecret('anthropic'), settings.ai.anthropic.model, settings.ai.visionModel);
    case 'openai-compat':
      return createOpenAiCompatProvider(
        settings.ai.openaiCompat.baseUrl,
        getDecryptedSecret('openaiCompat'),
        settings.ai.openaiCompat.model,
        settings.ai.visionModel,
      );
    default: {
      const exhaustive: never = settings.ai.provider;
      throw new Error(`未知的 AI Provider：${String(exhaustive)}`);
    }
  }
}

/** 把 Provider 抛出的原始异常（网络错误、鉴权失败、超时……）翻译成用户能看懂、能行动的中文提示。 */
export function humanizeProviderError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/claude CLI 超时|codex CLI 超时|响应超时|timeout|timed out/i.test(msg)) return '响应超时，请稍后重试或检查网络连接。';
  if (/未检测到 codex 命令/i.test(msg)) return '未检测到 codex 命令，请确认已安装并登录 Codex CLI。';
  if (/ENOENT|未检测到 claude 命令/i.test(msg)) return '未检测到 claude 命令，请确认已安装并登录 Claude Code CLI。';
  if (/401|Unauthorized|invalid x-api-key|authentication/i.test(msg)) return 'API Key 无效或未配置，请在设置中检查后重试。';
  if (/请先在设置中/.test(msg)) return msg;
  if (/429|rate.?limit/i.test(msg)) return '请求过于频繁，触发限流，请稍后重试。';
  if (/ENOTFOUND|ECONNREFUSED|fetch failed|network|EAI_AGAIN/i.test(msg)) return '网络连接失败，请检查网络或代理设置。';
  return msg || '未知错误。';
}
