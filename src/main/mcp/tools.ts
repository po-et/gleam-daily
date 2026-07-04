// SPEC §17.G 的 6 个只读 MCP 工具。全部只读、输入用 zod 校验、输出把 JSON 字符串放进 content[].text。
// 数据读取：直接复用 db.ts 的查询函数与 dayStats.computeDayStats；stats 相关（top apps / 分类时长 / 概览）
// 统一复用 src/main/stats.ts（与统计页同一套查询，口径永不漂移）。
// 每个工具调用都会写一条 McpLogEntry（见 ./log.ts）。
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { Category } from '../../shared/types';
import { computeDayStats } from '../dayStats';
import { getCategoryTotals as statsCategoryTotals, getOverview as statsGetOverview, getTopApps as statsGetTopApps } from '../stats';
import { getDb, getScreenshotAnalyses, getSessions, listNotes, listReports as dbListReports, getReport as dbGetReport } from '../db';
import { recordLog, safeArgsJson } from './log';

const DAY_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// 时间/日期小工具（全部按本机本地时区）
// ---------------------------------------------------------------------------

function localDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function todayStr(): string {
  return localDateStr(new Date());
}

/** 某天的 [00:00, 次日00:00) 半开区间（本地时区）。 */
function dayRangeExclusive(date: string): [number, number] {
  const start = new Date(`${date}T00:00:00`).getTime();
  return [start, start + DAY_MS];
}

/** epoch ms -> 'HH:mm'（本地）。 */
function hhmm(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function msToMin(ms: number): number {
  return Math.round(ms / 60000);
}

function catMapMinutes(map: Partial<Record<Category, number>>): Partial<Record<Category, number>> {
  const out: Partial<Record<Category, number>> = {};
  for (const [k, v] of Object.entries(map)) {
    if (typeof v === 'number') out[k as Category] = msToMin(v);
  }
  return out;
}

// ---------------------------------------------------------------------------
// SQL 小工具
// ---------------------------------------------------------------------------

/** 表是否存在（manual_records / meta 由并行 agent 的 additive migration 建，可能尚未落地——查询前先探测，缺表按空处理，不崩）。 */
function tableExists(name: string): boolean {
  const row = getDb()
    .prepare<[string], { name: string }>(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`)
    .get(name);
  return Boolean(row);
}

function count2(sql: string, a: number, b: number): number {
  const row = getDb().prepare<[number, number], { c: number }>(sql).get(a, b);
  return row ? row.c : 0;
}

/** LIKE 通配转义：先转义反斜杠，再转义 % 和 _。配合 SQL 中的 ESCAPE '\' 使用。 */
function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

// ---------------------------------------------------------------------------
// 手动记录（manual_records 表；表可能未建 -> 返回空）
// ---------------------------------------------------------------------------

interface ManualRow {
  id: number;
  ts: number;
  category: string;
  title: string;
  content: string;
  source: string;
}

function queryManualRecords(startTs: number, endTs: number): ManualRow[] {
  if (!tableExists('manual_records')) return [];
  return getDb()
    .prepare<[number, number], ManualRow>(
      `SELECT id, ts, category, title, content, source FROM manual_records WHERE ts >= ? AND ts < ? ORDER BY ts ASC`,
    )
    .all(startTs, endTs);
}

// ---------------------------------------------------------------------------
// 工具 1: get_day_overview
// ---------------------------------------------------------------------------

function getDayOverview(dateArg?: string): unknown {
  const date = dateArg && dateArg.trim() ? dateArg.trim() : todayStr();
  const [ds, de] = dayRangeExclusive(date);
  const stats = computeDayStats(date, getSessions(ds, de));

  return {
    date,
    totalActiveMinutes: msToMin(stats.totalActiveMs),
    byCategoryMinutes: catMapMinutes(stats.byCategory),
    topApps: stats.topApps.map((a) => ({ app: a.app, minutes: msToMin(a.ms) })),
    contextSwitches: stats.contextSwitches,
    focusBlocks: stats.focusBlocks.map((b) => ({
      start: hhmm(b.startTs),
      end: hhmm(b.endTs),
      category: b.category,
      minutes: msToMin(b.endTs - b.startTs),
    })),
    screenshotCount: count2(
      `SELECT COUNT(*) c FROM screenshots WHERE ts >= ? AND ts < ? AND status = 'analyzed' AND summary != ''`,
      ds,
      de,
    ),
    noteCount: count2(`SELECT COUNT(*) c FROM notes WHERE ts >= ? AND ts < ?`, ds, de),
    commitCount: count2(`SELECT COUNT(*) c FROM git_commits WHERE ts >= ? AND ts < ?`, ds, de),
    manualRecordCount: queryManualRecords(ds, de).length,
  };
}

// ---------------------------------------------------------------------------
// 工具 2: list_activities
// ---------------------------------------------------------------------------

function listActivities(date: string, includeDetails: boolean): unknown {
  const [ds, de] = dayRangeExclusive(date);

  const sessions = getSessions(ds, de)
    .map((s) => ({ ...s, startTs: Math.max(s.startTs, ds), endTs: Math.min(s.endTs, de) }))
    .filter((s) => s.endTs > s.startTs)
    .sort((a, b) => a.startTs - b.startTs)
    .map((s) => ({
      start: hhmm(s.startTs),
      end: hhmm(s.endTs),
      minutes: msToMin(s.endTs - s.startTs),
      app: s.app,
      category: s.category,
      ...(includeDetails && s.title ? { title: s.title } : {}),
    }));

  const screenshots = getScreenshotAnalyses(ds, de)
    .filter((a) => a.status === 'analyzed' && a.summary)
    .map((a) => ({ time: hhmm(a.ts), summary: a.summary, category: a.category, app: a.app }));

  const manualRecords = queryManualRecords(ds, de).map((r) => ({
    time: hhmm(r.ts),
    category: r.category,
    title: r.title,
    content: r.content,
    source: r.source,
  }));

  const notes = listNotes(ds, de)
    .slice()
    .sort((a, b) => a.ts - b.ts)
    .map((n) => ({ time: hhmm(n.ts), content: n.content }));

  return { date, sessions, screenshots, manualRecords, notes };
}

// ---------------------------------------------------------------------------
// 工具 3: search_activities
// ---------------------------------------------------------------------------

interface SearchHit {
  ts: number;
  date: string;
  time: string;
  type: 'session' | 'screenshot' | 'note' | 'manual' | 'commit';
  text: string;
}

function searchActivities(query: string, days: number): unknown {
  const trimmed = query.trim();
  if (!trimmed) return { query, days, count: 0, hits: [] };

  const start = new Date(`${todayStr()}T00:00:00`).getTime() - (days - 1) * DAY_MS;
  const like = `%${escapeLike(trimmed)}%`;
  const db = getDb();
  const hits: SearchHit[] = [];

  const sessionRows = db
    .prepare<[number, string], { start_ts: number; app: string; title: string }>(
      `SELECT start_ts, app, title FROM sessions WHERE start_ts >= ? AND title LIKE ? ESCAPE '\\' ORDER BY start_ts DESC LIMIT 50`,
    )
    .all(start, like);
  for (const r of sessionRows) hits.push({ ts: r.start_ts, date: '', time: '', type: 'session', text: `${r.app}: ${r.title}` });

  const shotRows = db
    .prepare<[number, string], { ts: number; summary: string }>(
      `SELECT ts, summary FROM screenshots WHERE ts >= ? AND status = 'analyzed' AND summary LIKE ? ESCAPE '\\' ORDER BY ts DESC LIMIT 50`,
    )
    .all(start, like);
  for (const r of shotRows) hits.push({ ts: r.ts, date: '', time: '', type: 'screenshot', text: r.summary });

  const noteRows = db
    .prepare<[number, string], { ts: number; content: string }>(
      `SELECT ts, content FROM notes WHERE ts >= ? AND content LIKE ? ESCAPE '\\' ORDER BY ts DESC LIMIT 50`,
    )
    .all(start, like);
  for (const r of noteRows) hits.push({ ts: r.ts, date: '', time: '', type: 'note', text: r.content });

  if (tableExists('manual_records')) {
    const manualRows = db
      .prepare<[number, string, string], { ts: number; title: string; content: string }>(
        `SELECT ts, title, content FROM manual_records WHERE ts >= ? AND (title LIKE ? ESCAPE '\\' OR content LIKE ? ESCAPE '\\') ORDER BY ts DESC LIMIT 50`,
      )
      .all(start, like, like);
    for (const r of manualRows) {
      const text = r.title ? `${r.title} — ${r.content}` : r.content;
      hits.push({ ts: r.ts, date: '', time: '', type: 'manual', text });
    }
  }

  const commitRows = db
    .prepare<[number, string], { ts: number; repo: string; message: string }>(
      `SELECT ts, repo, message FROM git_commits WHERE ts >= ? AND message LIKE ? ESCAPE '\\' ORDER BY ts DESC LIMIT 50`,
    )
    .all(start, like);
  for (const r of commitRows) hits.push({ ts: r.ts, date: '', time: '', type: 'commit', text: `[${r.repo}] ${r.message}` });

  hits.sort((a, b) => b.ts - a.ts);
  const capped = hits.slice(0, 50).map((h) => {
    const d = new Date(h.ts);
    return { date: localDateStr(d), time: hhmm(h.ts), type: h.type, text: h.text };
  });

  return { query: trimmed, days, count: capped.length, hits: capped };
}

// ---------------------------------------------------------------------------
// 工具 4: list_reports / get_report
// ---------------------------------------------------------------------------

function firstLine(md: string): string {
  const line = md.split('\n').find((l) => l.trim().length > 0) ?? '';
  const clean = line.replace(/^#+\s*/, '').trim();
  return clean.length > 80 ? `${clean.slice(0, 80)}…` : clean;
}

function listReports(type: string | undefined, limit: number): unknown {
  let reports = dbListReports(); // 已按 createdTs 降序
  if (type) reports = reports.filter((r) => r.type === type);
  const sliced = reports.slice(0, limit).map((r) => ({
    id: r.id,
    type: r.type,
    template: r.template,
    periodStart: r.periodStart,
    periodEnd: r.periodEnd,
    model: r.model,
    createdDate: localDateStr(new Date(r.createdTs)),
    createdTs: r.createdTs,
    title: firstLine(r.contentMd),
    contentLength: r.contentMd.length,
  }));
  return { count: sliced.length, reports: sliced };
}

function getReport(id: number): unknown {
  const r = dbGetReport(id);
  if (!r) return { found: false, id };
  return {
    found: true,
    id: r.id,
    type: r.type,
    template: r.template,
    periodStart: r.periodStart,
    periodEnd: r.periodEnd,
    model: r.model,
    createdTs: r.createdTs,
    createdDate: localDateStr(new Date(r.createdTs)),
    contentMd: r.contentMd,
  };
}

// ---------------------------------------------------------------------------
// 工具 5: get_stats（复用 §17.B 语义：概览 + top apps + 分类时长）
// ---------------------------------------------------------------------------

function getStats(days: number): unknown {
  const overview = statsGetOverview();
  return {
    days,
    overview: {
      streakDays: overview.streakDays,
      totalActiveDays: overview.totalActiveDays,
      avgDailyActiveMinutes30d: msToMin(overview.avgDailyActiveMs30d),
      totalSessions: overview.totalSessions,
      totalScreenshots: overview.totalScreenshots,
      totalReports: overview.totalReports,
    },
    topApps: statsGetTopApps(days).map((a) => ({ app: a.app, minutes: msToMin(a.ms), category: a.category })),
    categoryMinutes: catMapMinutes(statsCategoryTotals(days)),
  };
}

// ---------------------------------------------------------------------------
// 注册：统一包一层日志 + JSON 序列化
// ---------------------------------------------------------------------------

const READ_ONLY = { readOnlyHint: true, openWorldHint: false } as const;

/** 执行数据函数，记录日志，把结果包成 CallToolResult（JSON 文本）。异常转为 isError 结果，绝不抛出。 */
function runTool(tool: string, args: unknown, fn: () => unknown): CallToolResult {
  const started = Date.now();
  try {
    const result = fn();
    recordLog({ ts: started, tool, argsJson: safeArgsJson(args), ok: true, durationMs: Date.now() - started });
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    recordLog({ ts: started, tool, argsJson: safeArgsJson(args), ok: false, durationMs: Date.now() - started });
    return { content: [{ type: 'text', text: JSON.stringify({ error: message }) }], isError: true };
  }
}

/** 在给定 McpServer 上注册全部 6 个只读工具。 */
export function registerTools(server: McpServer): void {
  server.registerTool(
    'get_day_overview',
    {
      title: 'Get day overview',
      description:
        'Summary of one day of tracked work: active minutes per category, top apps, focus blocks, context switches, and counts of screenshots/notes/commits/manual records. Arg `date` is YYYY-MM-DD (local); omit for today.',
      inputSchema: { date: z.string().optional().describe('Local date YYYY-MM-DD; defaults to today') },
      annotations: READ_ONLY,
    },
    async (args) => runTool('get_day_overview', args, () => getDayOverview(args.date)),
  );

  server.registerTool(
    'list_activities',
    {
      title: 'List activities for a day',
      description:
        'Full timeline for one day: app sessions (minute granularity, start/end/app/category), screenshot summaries, manual records, and quick notes. Set `includeDetails` true to include window titles.',
      inputSchema: {
        date: z.string().describe('Local date YYYY-MM-DD'),
        includeDetails: z.boolean().optional().describe('Include window titles for sessions (default false)'),
      },
      annotations: READ_ONLY,
    },
    async (args) => runTool('list_activities', args, () => listActivities(args.date, args.includeDetails ?? false)),
  );

  server.registerTool(
    'search_activities',
    {
      title: 'Search activities',
      description:
        'Case-insensitive substring search over the last `days` days across session titles, screenshot summaries, notes, manual records, and git commit messages. Returns up to 50 dated hits, newest first.',
      inputSchema: {
        query: z.string().describe('Substring to search for'),
        days: z.number().int().positive().optional().describe('Look-back window in days (default 30)'),
      },
      annotations: READ_ONLY,
    },
    async (args) => runTool('search_activities', args, () => searchActivities(args.query, args.days ?? 30)),
  );

  server.registerTool(
    'list_reports',
    {
      title: 'List reports',
      description:
        'List generated report metadata (id, type, template, period, model, title, length), newest first. Optional `type` filters daily/weekly/monthly; `limit` caps results (default 20).',
      inputSchema: {
        type: z.enum(['daily', 'weekly', 'monthly']).optional().describe('Filter by report type'),
        limit: z.number().int().positive().optional().describe('Max reports to return (default 20)'),
      },
      annotations: READ_ONLY,
    },
    async (args) => runTool('list_reports', args, () => listReports(args.type, args.limit ?? 20)),
  );

  server.registerTool(
    'get_report',
    {
      title: 'Get report',
      description: 'Fetch a single report by id, including its full Markdown content. Returns { found: false } if the id does not exist.',
      inputSchema: { id: z.number().int().describe('Report id') },
      annotations: READ_ONLY,
    },
    async (args) => runTool('get_report', args, () => getReport(args.id)),
  );

  server.registerTool(
    'get_stats',
    {
      title: 'Get stats',
      description:
        'Aggregate statistics over the last `days` days (default 30): overall overview (streak, active days, averages, totals), top 15 apps with their main category, and total minutes per category.',
      inputSchema: { days: z.number().int().positive().optional().describe('Look-back window in days (default 30)') },
      annotations: READ_ONLY,
    },
    async (args) => runTool('get_stats', args, () => getStats(args.days ?? 30)),
  );
}
