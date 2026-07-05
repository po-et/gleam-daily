// v1.3 定时日报 + 记忆自动刷新（SPEC §17.E / §17.A）。
// 30s tick：到点且今天未跑 → 先写 lastRunDate 防重入 → 生成日报（或跳过）→ 系统通知。
// 同一 tick 顺带检查记忆自动刷新（先日报后记忆，各自 async 不阻塞主线程）。
import { Notification } from 'electron';
import type { Report, ReportTemplate, ScheduledReportStatus, Settings } from '../shared/types';
import { isClaudeCliAvailable, isCodexCliAvailable } from './ai';
import { getMeta, listReports, setMeta } from './db';
import { getMemory, refreshMemory, refreshPreview } from './memory';
import { generateReport } from './reports/generator';
import { getSettings } from './settings';
import { navigateMainWindow, showMainWindow } from './windows';

const TICK_INTERVAL_MS = 30_000;
const DAY_MS = 24 * 60 * 60 * 1000;

const META_LAST_RUN_DATE = 'scheduler.lastRunDate';
const META_LAST_RESULT = 'scheduler.lastResult';

let timer: ReturnType<typeof setInterval> | null = null;
let ticking = false;

interface StoredResult {
  result: 'success' | 'failed' | 'skipped';
  message: string;
  ranAt: number;
  date: string;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function dateStr(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** 解析 'HH:mm'，非法回退 18:00。 */
function parseHHmm(time: string): { h: number; m: number } {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!match) return { h: 18, m: 0 };
  const h = Math.min(23, Math.max(0, Number(match[1])));
  const m = Math.min(59, Math.max(0, Number(match[2])));
  return { h, m };
}

function targetTsForDate(baseTs: number, time: string): number {
  const { h, m } = parseHHmm(time);
  const d = new Date(baseTs);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m, 0, 0).getTime();
}

function computeNextRunAt(time: string, lastRunDate: string | null): number {
  const now = Date.now();
  const today = dateStr(now);
  const todayTarget = targetTsForDate(now, time);
  if (now < todayTarget && lastRunDate !== today) {
    return todayTarget;
  }
  return targetTsForDate(now + DAY_MS, time);
}

// ---------------------------------------------------------------------------
// 状态 / 通知
// ---------------------------------------------------------------------------

function readStoredResult(): StoredResult | null {
  const raw = getMeta(META_LAST_RESULT);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<StoredResult>;
    if (parsed.result === 'success' || parsed.result === 'failed' || parsed.result === 'skipped') {
      return {
        result: parsed.result,
        message: typeof parsed.message === 'string' ? parsed.message : '',
        ranAt: typeof parsed.ranAt === 'number' ? parsed.ranAt : 0,
        date: typeof parsed.date === 'string' ? parsed.date : '',
      };
    }
  } catch {
    // 忽略损坏值
  }
  return null;
}

function persistResult(res: StoredResult): void {
  setMeta(META_LAST_RESULT, JSON.stringify(res));
}

export function getScheduledReportStatus(): ScheduledReportStatus {
  const settings = getSettings();
  const lastRunDate = getMeta(META_LAST_RUN_DATE);
  const stored = readStoredResult();
  return {
    lastRunDate: lastRunDate ?? null,
    lastResult: stored?.result ?? null,
    lastMessage: stored?.message ?? '',
    nextRunAt: settings.scheduledReport.enabled ? computeNextRunAt(settings.scheduledReport.time, lastRunDate ?? null) : null,
  };
}

function notify(title: string, body: string): void {
  if (!Notification.isSupported()) return;
  const n = new Notification({ title, body });
  n.on('click', () => {
    showMainWindow();
    navigateMainWindow('#/reports');
  });
  n.show();
}

// ---------------------------------------------------------------------------
// 日报生成
// ---------------------------------------------------------------------------

function dailyReportsForDate(date: string): Report[] {
  return listReports().filter((r) => r.type === 'daily' && r.periodStart === date);
}

/**
 * 执行一次日报生成流程。
 * - force=false（到点自动）：今天已有日报则记 skipped。
 * - force=true（立即试跑 / E2E）：无视既有日报强制生成。
 * generateReport 内部把异常吞进 progress 事件、不抛出，故用「生成前后新增日报」判定成败。
 */
async function runScheduledReport(
  date: string,
  template: ReportTemplate,
  extraInstructions: string,
  opts: { force: boolean; notify: boolean },
): Promise<StoredResult> {
  if (!opts.force && dailyReportsForDate(date).length > 0) {
    const res: StoredResult = { result: 'skipped', message: '今天已存在日报，跳过自动生成。', ranAt: Date.now(), date };
    persistResult(res);
    return res;
  }

  const beforeMaxId = dailyReportsForDate(date).reduce((mx, r) => Math.max(mx, r.id), 0);
  // v1.4：定时日报按用户配置的默认详略等级生成（SPEC §18.B3）。
  await generateReport({ type: 'daily', date, template, extraInstructions, detail: getSettings().report.defaultDetail });
  const created = dailyReportsForDate(date).some((r) => r.id > beforeMaxId);

  let res: StoredResult;
  if (created) {
    res = { result: 'success', message: `${date} 日报已生成。`, ranAt: Date.now(), date };
    if (opts.notify) notify('今日日报已生成', '点击查看今天的日报。');
  } else {
    res = { result: 'failed', message: '日报生成失败，请检查 AI 设置或网络后重试。', ranAt: Date.now(), date };
    if (opts.notify) notify('日报生成失败', res.message);
  }
  persistResult(res);
  return res;
}

async function maybeRunScheduledReport(): Promise<void> {
  const settings = getSettings();
  if (!settings.scheduledReport.enabled) return;
  const now = Date.now();
  const today = dateStr(now);
  if (now < targetTsForDate(now, settings.scheduledReport.time)) return; // 未到点
  if (getMeta(META_LAST_RUN_DATE) === today) return; // 今天已跑过（防重入）
  // 先写 lastRunDate 防重入，再执行（即便生成失败也不在同一天反复重试）。
  setMeta(META_LAST_RUN_DATE, today);
  await runScheduledReport(today, settings.scheduledReport.template, settings.scheduledReport.extraInstructions, {
    force: false,
    notify: true,
  });
}

/** SPEC §17.E：忽略 lastRunDate 与 time，立即执行一次完整流程（含通知）。供设置页「立即试跑」与 E2E。 */
export async function runScheduledReportNow(): Promise<ScheduledReportStatus> {
  const settings = getSettings();
  const date = dateStr(Date.now());
  await runScheduledReport(date, settings.scheduledReport.template, settings.scheduledReport.extraInstructions, {
    force: true,
    notify: true,
  });
  return getScheduledReportStatus();
}

// ---------------------------------------------------------------------------
// 记忆自动刷新（SPEC §17.A）
// ---------------------------------------------------------------------------

async function isProviderAvailable(settings: Settings): Promise<boolean> {
  switch (settings.ai.provider) {
    case 'claude-cli':
      return isClaudeCliAvailable();
    case 'codex-cli':
      return isCodexCliAvailable();
    case 'anthropic':
      return settings.ai.anthropic.hasKey;
    case 'openai-compat':
      return settings.ai.openaiCompat.hasKey && settings.ai.openaiCompat.baseUrl.trim() !== '';
    default:
      return false;
  }
}

async function maybeRefreshMemory(): Promise<void> {
  const settings = getSettings();
  const mode = settings.memory.autoRefresh;
  if (mode === 'off' || !settings.memory.enabled) return;

  const { updatedTs } = getMemory();
  const threshold = mode === 'daily' ? DAY_MS : 7 * DAY_MS;
  if (updatedTs > 0 && Date.now() - updatedTs < threshold) return; // 尚未到刷新间隔

  // 无素材则不必调用 AI，避免空转。
  const preview = refreshPreview();
  if (preview.sessionCount === 0 && preview.screenshotCount === 0 && preview.noteCount === 0 && preview.commitCount === 0) return;

  if (!(await isProviderAvailable(settings))) return;

  try {
    await refreshMemory();
    console.log('[scheduler] 已自动刷新工作记忆。');
  } catch (err) {
    console.warn('[scheduler] 自动刷新记忆失败：', err instanceof Error ? err.message : String(err));
  }
}

// ---------------------------------------------------------------------------
// tick 循环
// ---------------------------------------------------------------------------

async function safeTick(): Promise<void> {
  if (ticking) return;
  ticking = true;
  try {
    await maybeRunScheduledReport();
    await maybeRefreshMemory();
  } catch (err) {
    console.warn('[scheduler] tick 异常：', err instanceof Error ? err.message : String(err));
  } finally {
    ticking = false;
  }
}

export function initScheduler(): void {
  if (timer) return;
  timer = setInterval(() => void safeTick(), TICK_INTERVAL_MS);
  // 启动后延迟一次，捕捉「重启前错过的到点时刻」并做首轮记忆检查。
  setTimeout(() => void safeTick(), 5_000);
}

export function stopScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
