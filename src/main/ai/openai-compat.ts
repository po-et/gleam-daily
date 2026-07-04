// AiProvider 实现：OpenAI 兼容端点，原生 fetch 实现（不引入 openai sdk）。见 docs/SPEC.md §11。
import fs from 'node:fs';
import type { ProviderTestResult } from '../../shared/types';
import type { AiProvider } from './index';

const SYSTEM_PROMPT = '你是一位严谨的工作汇报助手';
const DEFAULT_MAX_TOKENS = 4000;
const VISION_MAX_TOKENS = 1024;
const CHAT_TIMEOUT_MS = 180_000;
const VISION_TIMEOUT_MS = 90_000;

interface ChatMessage {
  role: 'system' | 'user';
  content: string | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }>;
}

interface ChatCompletionResponse {
  choices?: { message?: { content?: string } }[];
  error?: { message?: string };
}

function buildUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '');
  return `${trimmed}/chat/completions`;
}

async function postChatCompletion(
  baseUrl: string,
  apiKey: string | null,
  model: string,
  messages: ChatMessage[],
  maxTokens: number,
  timeoutMs: number,
): Promise<string> {
  if (!baseUrl.trim()) throw new Error('请先在设置中配置服务地址（baseUrl）。');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(buildUrl(baseUrl), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({ model, messages, max_tokens: maxTokens }),
      signal: controller.signal,
    });

    const text = await response.text();
    let parsed: ChatCompletionResponse;
    try {
      parsed = JSON.parse(text) as ChatCompletionResponse;
    } catch {
      throw new Error(`响应不是合法 JSON（HTTP ${response.status}）：${text.slice(0, 200)}`);
    }

    if (!response.ok) {
      throw new Error(parsed.error?.message ?? `HTTP ${response.status}`);
    }
    const content = parsed.choices?.[0]?.message?.content;
    if (typeof content !== 'string') {
      throw new Error('响应缺少 choices[0].message.content 字段');
    }
    return content;
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`请求超时（超过 ${Math.round(timeoutMs / 1000)}s 未返回）`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export function createOpenAiCompatProvider(baseUrl: string, apiKey: string | null, model: string, visionModel: string): AiProvider {
  return {
    async chat(prompt: string, opts?: { maxTokens?: number }): Promise<string> {
      if (!apiKey) throw new Error('请先在设置中配置 API Key。');
      return postChatCompletion(
        baseUrl,
        apiKey,
        model,
        [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: prompt },
        ],
        opts?.maxTokens ?? DEFAULT_MAX_TOKENS,
        CHAT_TIMEOUT_MS,
      );
    },

    async analyzeImage(imagePath: string, prompt: string): Promise<string> {
      if (!apiKey) throw new Error('请先在设置中配置 API Key。');
      const base64 = fs.readFileSync(imagePath).toString('base64');
      return postChatCompletion(
        baseUrl,
        apiKey,
        visionModel,
        [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64}` } },
            ],
          },
        ],
        VISION_MAX_TOKENS,
        VISION_TIMEOUT_MS,
      );
    },

    async test(): Promise<ProviderTestResult> {
      const start = Date.now();
      try {
        if (!baseUrl.trim()) return { ok: false, message: '请先在设置中配置服务地址（baseUrl）。' };
        if (!apiKey) return { ok: false, message: '请先在设置中配置 API Key。' };
        const text = await postChatCompletion(
          baseUrl,
          apiKey,
          model,
          [{ role: 'user', content: '只回复两个字：正常' }],
          20,
          30_000,
        );
        return { ok: true, message: `连接成功：${text.trim().slice(0, 60)}`, latencyMs: Date.now() - start };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { ok: false, message: msg || '未知错误。' };
      }
    },
  };
}
