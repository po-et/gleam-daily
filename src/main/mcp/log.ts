// MCP 请求日志：内存环形数组，最多保留 200 条 McpLogEntry（SPEC §17.G）。
// 每次工具调用（成功或失败）都会记录一条，供设置页通过 mcp:getLogs 展示。
// 纯内存、不落库；进程退出即清空——这是隐私红线的一部分（不持久化 Agent 的访问痕迹）。
import type { McpLogEntry } from '../../shared/types';

const MAX_ENTRIES = 200;
const MAX_ARGS_JSON = 500; // 单条 argsJson 截断上限，避免超大入参撑爆内存/UI

// 环形缓冲：按时间顺序 push，超过上限从头部丢弃最旧的一条。
const buffer: McpLogEntry[] = [];

/** 把任意入参安全序列化为字符串（截断到 MAX_ARGS_JSON），永不抛错。 */
export function safeArgsJson(args: unknown): string {
  let text: string;
  try {
    text = JSON.stringify(args ?? {});
  } catch {
    text = '"[unserializable]"';
  }
  if (text.length > MAX_ARGS_JSON) {
    return `${text.slice(0, MAX_ARGS_JSON)}…`;
  }
  return text;
}

/** 记录一次工具调用。 */
export function recordLog(entry: McpLogEntry): void {
  buffer.push(entry);
  if (buffer.length > MAX_ENTRIES) {
    buffer.splice(0, buffer.length - MAX_ENTRIES);
  }
}

/** 返回日志副本，最新的在前（供设置页展示）。 */
export function getLogs(): McpLogEntry[] {
  return [...buffer].reverse();
}

/** 清空日志（例如 stop 时可选调用；当前保留历史，不主动清）。 */
export function clearLogs(): void {
  buffer.length = 0;
}
