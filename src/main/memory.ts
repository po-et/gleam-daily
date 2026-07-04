// v1.3 记忆引擎（SPEC §17.A）。
// AI 从历史记录提炼「个人工作画像」（项目/产品标准名、技术栈、协作对象、工作习惯、术语对照），
// 注入截图分析与报告生成 prompt，解决 AI 认错项目名/术语的问题。
// 存储：meta 表（memory.content / memory.updatedTs）。
import { CATEGORY_META } from '../shared/categories';
import type { Category, GitCommit, ManualRecord, MemoryRefreshPreview, MemoryState, Note, ScreenshotAnalysis, Session } from '../shared/types';
import { getProvider } from './ai';
import { getCommits, getMeta, getScreenshotAnalyses, getSessions, listManualRecords, listNotes, setMeta } from './db';
import { buildMemoryPrompt, formatMemoryBlock } from './reports/prompts';
import { getSettings } from './settings';

const LOOKBACK_DAYS = 30; // 素材回看窗口
const MATERIAL_CHAR_LIMIT = 16000; // 素材总量截断（SPEC §17.A）
const DAY_MS = 24 * 60 * 60 * 1000;

const META_CONTENT = 'memory.content';
const META_UPDATED = 'memory.updatedTs';

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function localDateStr(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function formatDuration(ms: number): string {
  const totalMinutes = Math.round(ms / 60_000);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h <= 0) return `${m}分钟`;
  if (m === 0) return `${h}小时`;
  return `${h}小时${m}分钟`;
}

function lookbackRange(): { startTs: number; endTs: number } {
  const now = Date.now();
  return { startTs: now - LOOKBACK_DAYS * DAY_MS, endTs: now };
}

// ---------------------------------------------------------------------------
// 读写
// ---------------------------------------------------------------------------

export function getMemory(): MemoryState {
  const content = getMeta(META_CONTENT) ?? '';
  const updatedRaw = getMeta(META_UPDATED);
  const parsed = updatedRaw ? Number(updatedRaw) : 0;
  const updatedTs = Number.isFinite(parsed) ? parsed : 0;
  return { content, updatedTs };
}

/** 用户手动编辑保存，或刷新后写入。 */
export function setMemory(content: string): MemoryState {
  const updatedTs = Date.now();
  setMeta(META_CONTENT, content);
  setMeta(META_UPDATED, String(updatedTs));
  return { content, updatedTs };
}

/** 供 screenshots.ts 复用：视觉分析记忆注入块（受 memory.enabled && injectToVision 控制）。 */
export function buildVisionMemoryInjection(): string {
  const settings = getSettings();
  if (!settings.memory.enabled || !settings.memory.injectToVision) return '';
  return formatMemoryBlock(getMemory().content, 'vision');
}

// ---------------------------------------------------------------------------
// 素材聚合（近 30 天，按天聚合压缩）
// ---------------------------------------------------------------------------

interface DayBucket {
  apps: Map<string, { ms: number; category: Category; titles: Set<string> }>;
  shots: string[];
  notes: string[];
  manual: string[];
  commits: string[];
}

function emptyBucket(): DayBucket {
  return { apps: new Map(), shots: [], notes: [], manual: [], commits: [] };
}

/** 把近 30 天素材按本地日聚合成紧凑 Markdown 文本。按日期倒序（新→旧），便于截断时优先保留近期。 */
function buildMaterialText(
  sessions: Session[],
  screenshots: ScreenshotAnalysis[],
  notes: Note[],
  commits: GitCommit[],
  manualRecords: ManualRecord[],
): string {
  const buckets = new Map<string, DayBucket>();
  const bucketFor = (ts: number): DayBucket => {
    const key = localDateStr(ts);
    let b = buckets.get(key);
    if (!b) {
      b = emptyBucket();
      buckets.set(key, b);
    }
    return b;
  };

  // sessions：按起始日归属，日内按 app 聚合。
  for (const s of sessions) {
    const dur = s.endTs - s.startTs;
    if (dur <= 0) continue;
    const b = bucketFor(s.startTs);
    const entry = b.apps.get(s.app) ?? { ms: 0, category: s.category, titles: new Set<string>() };
    entry.ms += dur;
    if (s.title) entry.titles.add(s.title);
    b.apps.set(s.app, entry);
  }
  for (const shot of screenshots) {
    if (shot.status !== 'analyzed' || !shot.summary) continue;
    bucketFor(shot.ts).shots.push(shot.summary);
  }
  for (const n of notes) {
    if (n.content.trim()) bucketFor(n.ts).notes.push(n.content.trim());
  }
  for (const r of manualRecords) {
    const catLabel = CATEGORY_META[r.category]?.label ?? r.category;
    const title = r.title ? `${r.title}：` : '';
    bucketFor(r.ts).manual.push(`（${catLabel}）${title}${r.content}`);
  }
  for (const c of commits) {
    bucketFor(c.ts).commits.push(`${c.repo}: ${c.message}`);
  }

  const dates = [...buckets.keys()].sort((a, b) => (a < b ? 1 : -1)); // 倒序
  const parts: string[] = [];
  for (const date of dates) {
    const b = buckets.get(date);
    if (!b) continue;
    const lines: string[] = [`## ${date}`];

    if (b.apps.size > 0) {
      const appLine = [...b.apps.entries()]
        .sort((a, x) => x[1].ms - a[1].ms)
        .map(([app, info]) => {
          const label = CATEGORY_META[info.category]?.label ?? info.category;
          if (info.category === 'leisure') return `${app}（${label}）${formatDuration(info.ms)}`;
          const titles = [...info.titles].slice(0, 3);
          const titlePart = titles.length ? ` 涉及 ${titles.join('；')}` : '';
          return `${app}（${label}）${formatDuration(info.ms)}${titlePart}`;
        })
        .join('；');
      lines.push(`时间线：${appLine}`);
    }
    if (b.shots.length > 0) {
      lines.push(`截图：${b.shots.slice(0, 8).join('；')}`);
    }
    if (b.manual.length > 0) {
      lines.push(`补录：${b.manual.join('；')}`);
    }
    if (b.notes.length > 0) {
      lines.push(`速记：${b.notes.join('；')}`);
    }
    if (b.commits.length > 0) {
      lines.push(`提交：${b.commits.slice(0, 12).join('；')}`);
    }
    parts.push(lines.join('\n'));
  }
  return parts.join('\n\n');
}

// ---------------------------------------------------------------------------
// preview / refresh
// ---------------------------------------------------------------------------

export function refreshPreview(): MemoryRefreshPreview {
  const { startTs, endTs } = lookbackRange();
  const sessions = getSessions(startTs, endTs);
  const screenshots = getScreenshotAnalyses(startTs, endTs).filter((s) => s.status === 'analyzed' && s.summary);
  const notes = listNotes(startTs, endTs);
  const commits = getCommits(startTs, endTs);
  const manualRecords = listManualRecords(startTs, endTs);
  const materialText = buildMaterialText(sessions, screenshots, notes, commits, manualRecords);
  return {
    sessionCount: sessions.length,
    screenshotCount: screenshots.length,
    noteCount: notes.length,
    commitCount: commits.length,
    charCount: materialText.length,
  };
}

export async function refreshMemory(): Promise<MemoryState> {
  const { startTs, endTs } = lookbackRange();
  const sessions = getSessions(startTs, endTs);
  const screenshots = getScreenshotAnalyses(startTs, endTs).filter((s) => s.status === 'analyzed' && s.summary);
  const notes = listNotes(startTs, endTs);
  const commits = getCommits(startTs, endTs);
  const manualRecords = listManualRecords(startTs, endTs);

  let material = buildMaterialText(sessions, screenshots, notes, commits, manualRecords);
  if (material.length > MATERIAL_CHAR_LIMIT) material = material.slice(0, MATERIAL_CHAR_LIMIT);

  const existing = getMemory().content;
  const prompt = buildMemoryPrompt(material, existing);
  const provider = getProvider(getSettings());
  const result = (await provider.chat(prompt)).trim();
  if (!result) throw new Error('AI 返回内容为空，请稍后重试。');
  return setMemory(result);
}
