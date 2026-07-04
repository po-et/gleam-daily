// AiProvider 实现：Anthropic SDK 直连（自备 API Key）。见 docs/SPEC.md §11。
import fs from 'node:fs';
import Anthropic from '@anthropic-ai/sdk';
import type { ProviderTestResult } from '../../shared/types';
import type { AiProvider } from './index';

const SYSTEM_PROMPT = '你是一位严谨的工作汇报助手';
const DEFAULT_MAX_TOKENS = 4000;
const VISION_MAX_TOKENS = 1024;
const REQUEST_TIMEOUT_MS = 180_000;

function extractText(content: Anthropic.ContentBlock[]): string {
  const block = content.find((b): b is Anthropic.TextBlock => b.type === 'text');
  if (!block) throw new Error('Anthropic 返回内容为空（无文本块）');
  return block.text;
}

export function createAnthropicProvider(apiKey: string | null, model: string, visionModel: string): AiProvider {
  const client = apiKey ? new Anthropic({ apiKey, timeout: REQUEST_TIMEOUT_MS }) : null;

  function ensureClient(): Anthropic {
    if (!client) throw new Error('请先在设置中配置 Anthropic API Key。');
    return client;
  }

  return {
    async chat(prompt: string, opts?: { maxTokens?: number }): Promise<string> {
      const message = await ensureClient().messages.create({
        model,
        max_tokens: opts?.maxTokens ?? DEFAULT_MAX_TOKENS,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: prompt }],
      });
      return extractText(message.content);
    },

    async analyzeImage(imagePath: string, prompt: string): Promise<string> {
      const base64 = fs.readFileSync(imagePath).toString('base64');
      const message = await ensureClient().messages.create({
        model: visionModel,
        max_tokens: VISION_MAX_TOKENS,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: base64 } },
              { type: 'text', text: prompt },
            ],
          },
        ],
      });
      return extractText(message.content);
    },

    async test(): Promise<ProviderTestResult> {
      const start = Date.now();
      try {
        const text = await this.chat('只回复两个字：正常', { maxTokens: 20 });
        return { ok: true, message: `连接成功：${text.trim().slice(0, 60)}`, latencyMs: Date.now() - start };
      } catch (err) {
        return { ok: false, message: humanizeAnthropicError(err) };
      }
    },
  };
}

function humanizeAnthropicError(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) return 'API Key 无效，请在设置中重新填写。';
  if (err instanceof Anthropic.PermissionDeniedError) return '该 API Key 无权访问所选模型。';
  if (err instanceof Anthropic.RateLimitError) return '请求过于频繁，触发限流，请稍后重试。';
  if (err instanceof Anthropic.APIConnectionError) return '网络连接失败，请检查网络或代理设置。';
  if (err instanceof Anthropic.APIError) return `Anthropic 接口错误（${err.status ?? '未知状态码'}）：${err.message}`;
  const msg = err instanceof Error ? err.message : String(err);
  return msg || '未知错误。';
}
