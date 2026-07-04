// 今日统计聚合。基于 db.getSessions 的原始行计算 DayStats（见 docs/SPEC.md §4 DayStats、§7 降噪规则）。
// 现在实现的是"能算多准算多准"的第一版：跨天按 [date 00:00, date+1 00:00) 裁剪 session 贡献；
// contextSwitches 忽略 < 10s 的 session；focusBlocks 合并同分类连续 session 且总时长 >= 25min。
// phase2（tracker.ts）接管真实采样后，可在此基础上按需精化（例如引入真实的时间缺口判断）。
import type { Category, DayStats, FocusBlock, Session } from '../shared/types';

const IGNORE_SESSION_MS = 10_000; // < 10s 的 session 不计入 contextSwitches
const FOCUS_BLOCK_MIN_MS = 25 * 60 * 1000; // 同类连续 >= 25min 才算一个专注块
const TOP_APPS_LIMIT = 8;
// 同类 session 之间允许的最大时间缺口：采样天然有 ~1 个采样间隔的缝隙（切应用时前一 session 收尾、
// 后一 session 从下次采样起算），需要容忍；但一旦缺口达到 idle 量级（默认 idleThreshold 180s），
// 说明中间有一段空白/离开，专注被打断，此时应断开专注块，避免把跨越长空白的两段短同类活动算成一大块。
const FOCUS_GAP_TOLERANCE_MS = 90_000;

function dayRange(date: string): { dayStart: number; dayEnd: number } {
  const dayStart = new Date(`${date}T00:00:00`).getTime();
  const dayEnd = dayStart + 24 * 60 * 60 * 1000;
  return { dayStart, dayEnd };
}

export function computeDayStats(date: string, rawSessions: Session[]): DayStats {
  const { dayStart, dayEnd } = dayRange(date);

  const clipped = rawSessions
    .map((s) => ({ ...s, startTs: Math.max(s.startTs, dayStart), endTs: Math.min(s.endTs, dayEnd) }))
    .filter((s) => s.endTs > s.startTs)
    .sort((a, b) => a.startTs - b.startTs);

  const byCategory: Partial<Record<Category, number>> = {};
  const appMsMap = new Map<string, number>();
  let totalActiveMs = 0;

  for (const s of clipped) {
    const dur = s.endTs - s.startTs;
    totalActiveMs += dur;
    byCategory[s.category] = (byCategory[s.category] ?? 0) + dur;
    appMsMap.set(s.app, (appMsMap.get(s.app) ?? 0) + dur);
  }

  const topApps = [...appMsMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_APPS_LIMIT)
    .map(([app, ms]) => ({ app, ms }));

  const significant = clipped.filter((s) => s.endTs - s.startTs >= IGNORE_SESSION_MS);
  let contextSwitches = 0;
  for (let i = 1; i < significant.length; i++) {
    if (significant[i]?.app !== significant[i - 1]?.app) contextSwitches++;
  }

  const focusBlocks: FocusBlock[] = [];
  let blockStart: number | null = null;
  let blockEnd: number | null = null;
  let blockCategory: Category | null = null;
  const flushBlock = () => {
    if (blockStart !== null && blockEnd !== null && blockCategory !== null && blockEnd - blockStart >= FOCUS_BLOCK_MIN_MS) {
      focusBlocks.push({ startTs: blockStart, endTs: blockEnd, category: blockCategory });
    }
    blockStart = null;
    blockEnd = null;
    blockCategory = null;
  };
  for (const s of clipped) {
    const continues = blockCategory === s.category && blockEnd !== null && s.startTs - blockEnd <= FOCUS_GAP_TOLERANCE_MS;
    if (continues) {
      blockEnd = s.endTs;
    } else {
      flushBlock();
      blockStart = s.startTs;
      blockEnd = s.endTs;
      blockCategory = s.category;
    }
  }
  flushBlock();

  return { date, totalActiveMs, byCategory, topApps, contextSwitches, focusBlocks };
}
