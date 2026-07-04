// 时间/日期格式化工具。纯函数，无副作用，供各页面复用。
// 注意：tsconfig.web.json 开了 noUncheckedIndexedAccess，字符串 split 后的下标访问会带 undefined，
// 这里统一用 parseDateStr 兜底，避免到处写 `?? 0`。

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'] as const;

interface DateParts {
  y: number;
  m: number; // 1-12
  d: number;
}

/** 解析 'YYYY-MM-DD'，解析失败的部分兜底为合理默认值，绝不抛异常。 */
function parseDateStr(dateStr: string): DateParts {
  const parts = dateStr.split('-');
  const y = Number(parts[0] ?? 0) || 1970;
  const m = Number(parts[1] ?? 1) || 1;
  const d = Number(parts[2] ?? 1) || 1;
  return { y, m, d };
}

/** Date -> 'YYYY-MM-DD'（本地时区）。 */
export function formatDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function todayDateString(): string {
  return formatDateKey(new Date());
}

/** 'YYYY-MM-DD' 当天 [startTs, endTs) 的本地时间边界（毫秒）。 */
export function dayRangeMs(dateStr: string): { startTs: number; endTs: number } {
  const { y, m, d } = parseDateStr(dateStr);
  const startTs = new Date(y, m - 1, d, 0, 0, 0, 0).getTime();
  const endTs = new Date(y, m - 1, d + 1, 0, 0, 0, 0).getTime();
  return { startTs, endTs };
}

/** 本周（周一为一周起点）[startTs, endTs) 边界，dateStr 为该周任一天。 */
export function weekRangeMs(dateStr: string): { startTs: number; endTs: number } {
  const { y, m, d } = parseDateStr(dateStr);
  const date = new Date(y, m - 1, d);
  const day = date.getDay(); // 0=周日
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(y, m - 1, d + diffToMonday, 0, 0, 0, 0);
  const nextMonday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 7);
  return { startTs: monday.getTime(), endTs: nextMonday.getTime() };
}

/** 本月 [startTs, endTs) 边界，dateStr 为该月任一天。 */
export function monthRangeMs(dateStr: string): { startTs: number; endTs: number } {
  const { y, m } = parseDateStr(dateStr);
  const start = new Date(y, m - 1, 1, 0, 0, 0, 0);
  const end = new Date(y, m, 1, 0, 0, 0, 0);
  return { startTs: start.getTime(), endTs: end.getTime() };
}

export function shiftDateString(dateStr: string, deltaDays: number): string {
  const { y, m, d } = parseDateStr(dateStr);
  return formatDateKey(new Date(y, m - 1, d + deltaDays));
}

/** "7月4日，星期五" */
export function formatDateHeading(dateStr: string): string {
  const { y, m, d } = parseDateStr(dateStr);
  const date = new Date(y, m - 1, d);
  const weekday = WEEKDAYS[date.getDay()] ?? '一';
  return `${m}月${d}日，星期${weekday}`;
}

/** 简短日期，用于历史列表等场景："7/4" */
export function formatDateShort(dateStr: string): string {
  const { m, d } = parseDateStr(dateStr);
  return `${m}/${d}`;
}

/** epoch ms -> "14:32"（24 小时制，mono 展示）。 */
export function formatClockTime(ts: number): string {
  const date = new Date(ts);
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

/** ms -> "4h 32m" / "32m" / "0m"。 */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0m';
  const totalMinutes = Math.round(ms / 60000);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h <= 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/** 截断长文本，超出加省略号。 */
export function truncate(text: string, maxLen: number): string {
  if (!text) return text;
  return text.length > maxLen ? `${text.slice(0, Math.max(0, maxLen - 1))}…` : text;
}

/** Git commit 短 hash（7 位）。 */
export function shortHash(hash: string): string {
  return hash.slice(0, 7);
}

/** 把 24h 内的一个时刻换算成当天 [0,1] 的比例，供时间轴定位使用。 */
export function fractionOfDay(ts: number, dayStartTs: number, dayEndTs: number): number {
  const span = dayEndTs - dayStartTs;
  if (span <= 0) return 0;
  return Math.min(1, Math.max(0, (ts - dayStartTs) / span));
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
