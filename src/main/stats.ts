// v1.3 统计聚合（SPEC §17.B）。全部基于 sessions 表按本地时区聚合；跨天 session 按本地天边界切分后归属。
// 实现策略：一次取范围内 sessions，在 JS 内切分聚合（365 天量级 ≤ 数万行，可接受）。
import type { AppUsagePeriod, AppUsageRow, AppUsageSummary, Category, HeatmapDay, StatsOverview, TopApp } from '../shared/types';
import { getDb, getSessions } from './db';

const DAY_MS = 24 * 60 * 60 * 1000;

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** 本地日期字符串 'YYYY-MM-DD'。 */
function localDateStr(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** 给定时间点所在本地日的 00:00 epoch ms。 */
function startOfDayTs(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** “近 days 天”区间：截止此刻，含今天在内共 days 个自然日。 */
function rangeForDays(days: number): { startTs: number; endTs: number } {
  const todayStart = startOfDayTs(Date.now());
  const startTs = todayStart - (Math.max(1, days) - 1) * DAY_MS;
  return { startTs, endTs: Date.now() };
}

/**
 * 把 [startTs, endTs) 按“单个本地小时”切块产出。小时边界天然包含午夜（0 点），因此同时解决了跨天与跨小时切分。
 * 每块用其起始时刻定位所属本地日 / 星期 / 小时。
 */
function* iterateHourChunks(startTs: number, endTs: number): Generator<{ ts: number; ms: number }> {
  let cursor = startTs;
  while (cursor < endTs) {
    const d = new Date(cursor);
    const hourStart = new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), 0, 0, 0).getTime();
    const hourEnd = hourStart + 60 * 60 * 1000;
    const chunkEnd = Math.min(endTs, hourEnd);
    yield { ts: cursor, ms: chunkEnd - cursor };
    cursor = chunkEnd;
  }
}

/** 每天活跃 ms（按本地天切分聚合）。 */
function buildDayMsMap(startTs: number, endTs: number): Map<string, number> {
  const sessions = getSessions(startTs, endTs);
  const map = new Map<string, number>();
  for (const s of sessions) {
    const cs = Math.max(s.startTs, startTs);
    const ce = Math.min(s.endTs, endTs);
    if (ce <= cs) continue;
    for (const chunk of iterateHourChunks(cs, ce)) {
      const key = localDateStr(chunk.ts);
      map.set(key, (map.get(key) ?? 0) + chunk.ms);
    }
  }
  return map;
}

function countRows(table: 'sessions' | 'screenshots' | 'reports'): number {
  const row = getDb().prepare<[], { c: number }>(`SELECT COUNT(*) AS c FROM ${table}`).get();
  return row?.c ?? 0;
}

export function getOverview(): StatsOverview {
  const now = Date.now();
  const dayMs = buildDayMsMap(0, now);

  const totalActiveDays = dayMs.size;

  // streakDays：从今天（若今天尚无记录则从昨天）向前连续有记录的天数。
  const todayStart = startOfDayTs(now);
  const todayKey = localDateStr(todayStart);
  let cursor = dayMs.has(todayKey) ? todayStart : todayStart - DAY_MS;
  let streakDays = 0;
  while (dayMs.has(localDateStr(cursor))) {
    streakDays += 1;
    cursor -= DAY_MS;
  }

  // avgDailyActiveMs30d：近 30 天里“有记录日”的平均活跃时长。
  let sum30 = 0;
  let recordedDays30 = 0;
  for (let i = 0; i < 30; i++) {
    const key = localDateStr(todayStart - i * DAY_MS);
    const ms = dayMs.get(key);
    if (ms && ms > 0) {
      sum30 += ms;
      recordedDays30 += 1;
    }
  }
  const avgDailyActiveMs30d = recordedDays30 > 0 ? Math.round(sum30 / recordedDays30) : 0;

  return {
    streakDays,
    totalActiveDays,
    avgDailyActiveMs30d,
    totalSessions: countRows('sessions'),
    totalScreenshots: countRows('screenshots'),
    totalReports: countRows('reports'),
  };
}

export function getHeatmap(days: number): HeatmapDay[] {
  const { startTs, endTs } = rangeForDays(days);
  const dayMs = buildDayMsMap(startTs, endTs);
  const todayStart = startOfDayTs(Date.now());
  const result: HeatmapDay[] = [];
  const count = Math.max(1, days);
  // 连续无空洞：从最早的一天到今天，逐日填充（无记录=0）。
  for (let i = count - 1; i >= 0; i--) {
    const date = localDateStr(todayStart - i * DAY_MS);
    result.push({ date, activeMs: dayMs.get(date) ?? 0 });
  }
  return result;
}

export function getHourMatrix(days: number): number[][] {
  const { startTs, endTs } = rangeForDays(days);
  const sessions = getSessions(startTs, endTs);
  // 7×24，[weekday][hour]，weekday 0=周一…6=周日。
  const matrix: number[][] = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
  for (const s of sessions) {
    const cs = Math.max(s.startTs, startTs);
    const ce = Math.min(s.endTs, endTs);
    if (ce <= cs) continue;
    for (const chunk of iterateHourChunks(cs, ce)) {
      const d = new Date(chunk.ts);
      const weekday = (d.getDay() + 6) % 7; // JS 0=周日 → 本项目 0=周一
      const hour = d.getHours();
      const row = matrix[weekday];
      if (row) row[hour] = (row[hour] ?? 0) + chunk.ms;
    }
  }
  return matrix;
}

export function getTopApps(days: number): TopApp[] {
  const { startTs, endTs } = rangeForDays(days);
  const sessions = getSessions(startTs, endTs);
  const byApp = new Map<string, { ms: number; cats: Map<Category, number> }>();
  for (const s of sessions) {
    const cs = Math.max(s.startTs, startTs);
    const ce = Math.min(s.endTs, endTs);
    const dur = ce - cs;
    if (dur <= 0) continue;
    const entry = byApp.get(s.app) ?? { ms: 0, cats: new Map<Category, number>() };
    entry.ms += dur;
    entry.cats.set(s.category, (entry.cats.get(s.category) ?? 0) + dur);
    byApp.set(s.app, entry);
  }
  const apps: TopApp[] = [...byApp.entries()].map(([app, info]) => {
    let topCat: Category = 'other';
    let max = -1;
    for (const [cat, ms] of info.cats) {
      if (ms > max) {
        max = ms;
        topCat = cat;
      }
    }
    return { app, ms: info.ms, category: topCat };
  });
  apps.sort((a, b) => b.ms - a.ms);
  return apps.slice(0, 15);
}

export function getCategoryTotals(days: number): Partial<Record<Category, number>> {
  const { startTs, endTs } = rangeForDays(days);
  const sessions = getSessions(startTs, endTs);
  const totals: Partial<Record<Category, number>> = {};
  for (const s of sessions) {
    const cs = Math.max(s.startTs, startTs);
    const ce = Math.min(s.endTs, endTs);
    const dur = ce - cs;
    if (dur <= 0) continue;
    totals[s.category] = (totals[s.category] ?? 0) + dur;
  }
  return totals;
}

// --- v1.4 应用记录（SPEC §18.A）---

/**
 * 周期边界（均到「此刻」为止）：
 * - today：今日 00:00
 * - week：本周周一 00:00
 * - month：本月 1 号 00:00
 * - 30d：近 30 天（今天在内共 30 个自然日）的起始 00:00
 */
function rangeForPeriod(period: AppUsagePeriod): { startTs: number; endTs: number } {
  const now = Date.now();
  const todayStart = startOfDayTs(now);
  switch (period) {
    case 'today':
      return { startTs: todayStart, endTs: now };
    case 'week': {
      const d = new Date(now);
      const mondayOffset = (d.getDay() + 6) % 7; // 0=周一
      return { startTs: todayStart - mondayOffset * DAY_MS, endTs: now };
    }
    case 'month': {
      const d = new Date(now);
      const monthStart = new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0).getTime();
      return { startTs: monthStart, endTs: now };
    }
    case '30d':
      return { startTs: todayStart - 29 * DAY_MS, endTs: now };
  }
}

/**
 * 应用记录（SPEC §18.A）：跨天/跨界 session 裁剪到周期边界后按 app 聚合。
 * - apps 按 ms 降序全量返回（截断交给 UI）；pct 为占 totalMs 的原始百分比；
 * - category 取该 app 时长最多的分类；firstTs/lastTs 为周期内该 app 首末 session 边界（已裁剪到周期内）；
 * - avgDailyMs = totalMs / 周期内「有记录的天数」（无记录天不摊薄）。
 */
export function getAppUsage(period: AppUsagePeriod): AppUsageSummary {
  const { startTs, endTs } = rangeForPeriod(period);

  interface AppAgg {
    ms: number;
    cats: Map<Category, number>;
    firstTs: number;
    lastTs: number;
  }

  const byApp = new Map<string, AppAgg>();
  let totalMs = 0;

  if (endTs > startTs) {
    const sessions = getSessions(startTs, endTs);
    for (const s of sessions) {
      const cs = Math.max(s.startTs, startTs);
      const ce = Math.min(s.endTs, endTs);
      const dur = ce - cs;
      if (dur <= 0) continue;
      totalMs += dur;
      const entry = byApp.get(s.app) ?? { ms: 0, cats: new Map<Category, number>(), firstTs: cs, lastTs: ce };
      entry.ms += dur;
      entry.cats.set(s.category, (entry.cats.get(s.category) ?? 0) + dur);
      if (cs < entry.firstTs) entry.firstTs = cs;
      if (ce > entry.lastTs) entry.lastTs = ce;
      byApp.set(s.app, entry);
    }
  }

  const apps: AppUsageRow[] = [...byApp.entries()].map(([app, info]) => {
    let topCat: Category = 'other';
    let max = -1;
    for (const [cat, ms] of info.cats) {
      if (ms > max) {
        max = ms;
        topCat = cat;
      }
    }
    return {
      app,
      ms: info.ms,
      pct: totalMs > 0 ? (info.ms / totalMs) * 100 : 0,
      category: topCat,
      firstTs: info.firstTs,
      lastTs: info.lastTs,
    };
  });
  apps.sort((a, b) => b.ms - a.ms);

  // 有记录的天数：复用按天切分逻辑，只数 ms>0 的自然日。
  const recordedDays = endTs > startTs ? buildDayMsMap(startTs, endTs).size : 0;
  const avgDailyMs = recordedDays > 0 ? Math.round(totalMs / recordedDays) : 0;

  return {
    period,
    totalApps: apps.length,
    totalMs,
    avgDailyMs,
    apps,
  };
}
