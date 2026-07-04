// 统计页共用：5 档强度色阶映射 + 本地日期解析。
// 色阶 CSS 变量 --gd-heat-0..4 定义在 Stats.css（浅/深双主题），此处只负责把强度级别翻成变量引用，
// 避免 noUncheckedIndexedAccess 下的下标越界告警（用 switch 直接返回字符串）。

const HOUR_MS = 3600_000;

/** 强度级别（0=空，1..4 递增）-> CSS 变量引用字符串。 */
export function heatColor(level: number): string {
  switch (level) {
    case 1:
      return 'var(--gd-heat-1)';
    case 2:
      return 'var(--gd-heat-2)';
    case 3:
      return 'var(--gd-heat-3)';
    case 4:
      return 'var(--gd-heat-4)';
    default:
      return 'var(--gd-heat-0)';
  }
}

/** 年度热力图：按单日活跃时长的绝对阈值分档（0 / <1h / <3h / <6h / >=6h）。 */
export function levelForDay(activeMs: number): number {
  if (!Number.isFinite(activeMs) || activeMs <= 0) return 0;
  if (activeMs < 1 * HOUR_MS) return 1;
  if (activeMs < 3 * HOUR_MS) return 2;
  if (activeMs < 6 * HOUR_MS) return 3;
  return 4;
}

/** 时段分布：格值为 30 天累计，按占当期最大格的相对比例分档（四分位）。 */
export function levelRelative(value: number, max: number): number {
  if (!Number.isFinite(value) || value <= 0 || max <= 0) return 0;
  const r = value / max;
  if (r <= 0.25) return 1;
  if (r <= 0.5) return 2;
  if (r <= 0.75) return 3;
  return 4;
}

export interface LocalDateParts {
  y: number;
  m: number; // 1-12
  d: number;
  date: Date;
}

/** 'YYYY-MM-DD' -> 本地时区各部件 + Date（避免 new Date(str) 的 UTC 偏移导致跨日）。 */
export function parseLocalDate(dateStr: string): LocalDateParts {
  const parts = dateStr.split('-');
  const y = Number(parts[0] ?? 0) || 1970;
  const m = Number(parts[1] ?? 1) || 1;
  const d = Number(parts[2] ?? 1) || 1;
  return { y, m, d, date: new Date(y, m - 1, d) };
}
