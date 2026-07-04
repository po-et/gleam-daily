// 汇集某时段的素材 -> ReportMaterial。见 docs/SPEC.md §10。
import { CATEGORY_META } from '../../shared/categories';
import type {
  Category,
  GitCommit,
  ManualRecord,
  MaterialPreview,
  Note,
  Report,
  ReportGenOptions,
  ReportType,
  ScreenshotAnalysis,
  Session,
} from '../../shared/types';
import { getCommits, getScreenshotAnalyses, getSessions, listManualRecords, listNotes, listReports } from '../db';

const SCREENSHOT_SAMPLE_LIMIT = 60;

export interface ReportMaterial {
  periodStart: string; // YYYY-MM-DD
  periodEnd: string; // YYYY-MM-DD（daily 时等于 periodStart）
  /** daily：当期原始 session 聚合；weekly/monthly：优先复用已有日报，没有日报的天回退原始聚合。 */
  timelineText: string;
  screenshotsText: string;
  commitsText: string;
  notesText: string;
  manualRecordsText: string;
  preview: MaterialPreview;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function toDateStr(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function toMidnightTs(dateStr: string): number {
  return new Date(`${dateStr}T00:00:00`).getTime();
}

function addDays(dateStr: string, days: number): string {
  return toDateStr(toMidnightTs(dateStr) + days * 86_400_000);
}

/** 根据 type + 任一天，换算出该 daily/weekly（周一至周日）/monthly（自然月）周期的起止日期（含端点）。 */
export function resolvePeriod(type: ReportType, date: string): { start: string; end: string } {
  if (type === 'daily') return { start: date, end: date };

  if (type === 'weekly') {
    const d = new Date(`${date}T00:00:00`);
    const mondayOffset = (d.getDay() + 6) % 7; // 0=周一
    const start = addDays(date, -mondayOffset);
    const end = addDays(start, 6);
    return { start, end };
  }

  // monthly：自然月 1 日至月末
  const d = new Date(`${date}T00:00:00`);
  const year = d.getFullYear();
  const month = d.getMonth();
  const start = `${year}-${pad2(month + 1)}-01`;
  const lastDay = new Date(year, month + 1, 0).getDate();
  const end = `${year}-${pad2(month + 1)}-${pad2(lastDay)}`;
  return { start, end };
}

function formatDuration(ms: number): string {
  const totalMinutes = Math.round(ms / 60_000);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h <= 0) return `${m}分钟`;
  if (m === 0) return `${h}小时`;
  return `${h}小时${m}分钟`;
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function sampleEvenly<T>(arr: T[], max: number): T[] {
  if (arr.length <= max) return arr;
  const step = arr.length / max;
  const result: T[] = [];
  for (let i = 0; i < max; i++) {
    const idx = Math.min(arr.length - 1, Math.floor(i * step));
    const item = arr[idx];
    if (item !== undefined) result.push(item);
  }
  return result;
}

/** sessions -> 「分类汇总 + 按应用聚合条目」，leisure 类只保留时长（过滤细节标题）。 */
export function formatSessions(sessions: Session[]): string {
  if (sessions.length === 0) return '（时间段内无活动记录）';

  const byCategory = new Map<Category, number>();
  const byApp = new Map<string, { ms: number; category: Category; titles: Set<string> }>();

  for (const s of sessions) {
    const dur = s.endTs - s.startTs;
    if (dur <= 0) continue;
    byCategory.set(s.category, (byCategory.get(s.category) ?? 0) + dur);
    const entry = byApp.get(s.app) ?? { ms: 0, category: s.category, titles: new Set<string>() };
    entry.ms += dur;
    if (s.title) entry.titles.add(s.title);
    byApp.set(s.app, entry);
  }

  const catLines = [...byCategory.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([cat, ms]) => `- ${CATEGORY_META[cat].label}：${formatDuration(ms)}`)
    .join('\n');

  const appLines = [...byApp.entries()]
    .sort((a, b) => b[1].ms - a[1].ms)
    .map(([app, info]) => {
      if (info.category === 'leisure') return `- ${app}：${formatDuration(info.ms)}`;
      const titles = [...info.titles].slice(0, 5);
      const titlePart = titles.length ? `，涉及：${titles.join('；')}` : '';
      return `- ${app}（${CATEGORY_META[info.category].label}）：${formatDuration(info.ms)}${titlePart}`;
    })
    .join('\n');

  return `分类时长汇总：\n${catLines}\n\n按应用条目：\n${appLines}`;
}

function formatScreenshots(items: ScreenshotAnalysis[]): string {
  const analyzed = items.filter((s) => s.status === 'analyzed' && s.summary);
  if (analyzed.length === 0) return '（未开启截图分析，或时间段内无有效记录）';
  const sampled = sampleEvenly(analyzed, SCREENSHOT_SAMPLE_LIMIT);
  return sampled.map((s) => `- ${formatTime(s.ts)} ${s.app}：${s.summary}`).join('\n');
}

function formatCommits(commits: GitCommit[]): string {
  if (commits.length === 0) return '（时间段内无 Git 提交记录）';
  const byRepo = new Map<string, GitCommit[]>();
  for (const c of commits) {
    const list = byRepo.get(c.repo) ?? [];
    list.push(c);
    byRepo.set(c.repo, list);
  }
  const parts: string[] = [];
  for (const [repo, list] of byRepo) {
    const sorted = [...list].sort((a, b) => a.ts - b.ts);
    const lines = sorted.map((c) => `  - ${c.hash.slice(0, 7)} ${c.message}（+${c.insertions} -${c.deletions}，${c.filesChanged} 个文件）`);
    parts.push(`${repo}（${list.length} 次提交）：\n${lines.join('\n')}`);
  }
  return parts.join('\n\n');
}

function formatNotes(notes: Note[]): string {
  if (notes.length === 0) return '（无手动速记）';
  return [...notes]
    .sort((a, b) => a.ts - b.ts)
    .map((n) => `- ${formatTime(n.ts)} ${n.content}`)
    .join('\n');
}

/** 手动补录（含传图识别，source=image）：用户主观补充，优先级最高，可直接采信。 */
function formatManualRecords(records: ManualRecord[]): string {
  if (records.length === 0) return '（无手动补录）';
  return [...records]
    .sort((a, b) => a.ts - b.ts)
    .map((r) => {
      const catLabel = CATEGORY_META[r.category]?.label ?? r.category;
      const sourceTag = r.source === 'image' ? '[图]' : '';
      const titlePart = r.title ? `${r.title}：` : '';
      return `- ${formatTime(r.ts)} ${sourceTag}（${catLabel}）${titlePart}${r.content}`;
    })
    .join('\n');
}

/** weekly/monthly：逐天检查是否已有 daily 报告，有则直接复用 contentMd（高质量素材）；没有则用当天原始数据聚合回退。 */
function buildTimelineForPeriod(type: ReportType, start: string, end: string, sessions: Session[]): { text: string; dailyReportCount: number } {
  if (type === 'daily') {
    return { text: formatSessions(sessions), dailyReportCount: 0 };
  }

  const allDailyReports = listReports().filter((r): r is Report => r.type === 'daily');
  const dailyByDate = new Map(allDailyReports.map((r) => [r.periodStart, r]));

  const days: string[] = [];
  for (let cursor = start; cursor <= end; cursor = addDays(cursor, 1)) {
    days.push(cursor);
    if (cursor === end) break;
  }

  let dailyReportCount = 0;
  const parts: string[] = [];
  for (const day of days) {
    const existing = dailyByDate.get(day);
    if (existing) {
      dailyReportCount += 1;
      parts.push(`### ${day}（已有日报）\n${existing.contentMd}`);
      continue;
    }
    const dayStartTs = toMidnightTs(day);
    const dayEndTs = dayStartTs + 86_400_000;
    const daySessions = sessions.filter((s) => s.startTs < dayEndTs && s.endTs > dayStartTs);
    if (daySessions.length === 0) continue; // 既没日报也没数据的天，跳过避免大段空文本
    parts.push(`### ${day}（原始记录聚合，无日报）\n${formatSessions(daySessions)}`);
  }

  const text = parts.length > 0 ? parts.join('\n\n') : '（该周期内没有可用的日报或活动记录）';
  return { text, dailyReportCount };
}

export async function collectMaterial(opts: ReportGenOptions): Promise<ReportMaterial> {
  const { start, end } = resolvePeriod(opts.type, opts.date);
  const startTs = toMidnightTs(start);
  const endTsExclusive = toMidnightTs(end) + 86_400_000;

  const sessions = getSessions(startTs, endTsExclusive);
  const screenshots = getScreenshotAnalyses(startTs, endTsExclusive);
  const commits = getCommits(startTs, endTsExclusive);
  const notes = listNotes(startTs, endTsExclusive);
  const manualRecords = listManualRecords(startTs, endTsExclusive);

  const { text: timelineText, dailyReportCount } = buildTimelineForPeriod(opts.type, start, end, sessions);

  const activeMs = sessions.reduce((sum, s) => sum + Math.max(0, s.endTs - s.startTs), 0);
  const analyzedScreenshotCount = screenshots.filter((s) => s.status === 'analyzed').length;

  const preview: MaterialPreview = {
    sessionCount: sessions.length,
    activeMs,
    screenshotCount: analyzedScreenshotCount,
    commitCount: commits.length,
    noteCount: notes.length,
    manualRecordCount: manualRecords.length,
    dailyReportCount,
  };

  return {
    periodStart: start,
    periodEnd: end,
    timelineText,
    screenshotsText: formatScreenshots(screenshots),
    commitsText: formatCommits(commits),
    notesText: formatNotes(notes),
    manualRecordsText: formatManualRecords(manualRecords),
    preview,
  };
}
