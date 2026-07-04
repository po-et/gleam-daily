// 前台应用轮询 -> session 聚合。核心模块，见 docs/SPEC.md §7。
//
// 采样循环用自调度的 setTimeout（而非 setInterval）：每次 tick 结束后才根据*最新*设置算出下一次
// 延迟，这样用户在设置页修改 sampleIntervalSec 后无需重启循环即可在下一 tick 生效。
import { execFile } from 'node:child_process';
import { BrowserWindow, powerMonitor } from 'electron';
import { categorize } from '../shared/categories';
import { IPC_CHANNELS } from '../shared/ipc-channels';
import type { Category, PermissionState, TrackerStatus } from '../shared/types';
import { insertSession, updateSessionEnd } from './db';
import { checkScreenRecordingPermission } from './permissions';
import { isBreakGap, isSameActivity } from './sessionAgg';
import { getSettings } from './settings';

const FRONTMOST_APP_SCRIPT = `tell application "System Events"
  set p to first application process whose frontmost is true
  set appName to name of p
  try
    set winTitle to name of front window of p
  on error
    set winTitle to ""
  end try
end tell
return appName & linefeed & winTitle`;

const UNAUTHORIZED_APP_LABEL = '(未授权)';
const BASE_BACKOFF_MS = 10_000;
const MAX_BACKOFF_MS = 5 * 60_000;
const OSASCRIPT_TIMEOUT_MS = 5_000;

interface CurrentSession {
  id: number;
  app: string;
  title: string;
  category: Category;
  startTs: number;
  lastTs: number;
}

let running = false;
let timer: ReturnType<typeof setTimeout> | null = null;
let currentSession: CurrentSession | null = null;
let lastTickAt: number | null = null;
let lastSampleTs: number | null = null;
let runtimeIdle = false;
let locked = false;
let awaitingOsascript = false;
let consecutiveAutomationFailures = 0;
let automationBackoffUntil = 0;
let automationPermission: PermissionState = 'unknown';
let listenersAttached = false;

function closeCurrentSession(): void {
  // DB 里的 end_ts 已经在每次采样时同步写过了，这里只需要清掉内存态，
  // 下一次采到不同的 app/title 时就会走 INSERT 新建一条 session。
  currentSession = null;
}

function openSession(app: string, title: string, category: Category, ts: number): void {
  const row = insertSession({ startTs: ts, endTs: ts, app, title, category });
  currentSession = { id: row.id, app, title, category, startTs: ts, lastTs: ts };
}

function upsertSample(app: string, title: string, category: Category, now: number): void {
  if (!currentSession) {
    openSession(app, title, category, now);
    return;
  }
  if (isSameActivity(currentSession, app, title)) {
    currentSession.lastTs = now;
    updateSessionEnd(currentSession.id, now);
    return;
  }
  closeCurrentSession();
  openSession(app, title, category, now);
}

function isExcludedApp(appName: string, excludedApps: string[]): boolean {
  const lower = appName.toLowerCase();
  return excludedApps.some((e) => e.trim() !== '' && lower.includes(e.trim().toLowerCase()));
}

function buildOsascriptEnv(): NodeJS.ProcessEnv {
  return { ...process.env, PATH: `${process.env.PATH ?? ''}:/usr/bin:/bin` };
}

function handleAutomationFailure(err: Error, now: number): void {
  const msg = err.message;
  const denied = msg.includes('-1743') || /not authorized/i.test(msg);
  consecutiveAutomationFailures += 1;
  const backoff = Math.min(BASE_BACKOFF_MS * 2 ** (consecutiveAutomationFailures - 1), MAX_BACKOFF_MS);
  automationBackoffUntil = Date.now() + backoff;

  if (denied) {
    automationPermission = 'denied';
    upsertSample(UNAUTHORIZED_APP_LABEL, '', 'other', now);
  } else if (automationPermission === 'granted') {
    // 之前正常、突然报错（例如 System Events 暂时无响应）：降级为 unknown，但不篡改 session，
    // 避免瞬时故障污染时间线；下次退避窗口结束后会重新探测。
    automationPermission = 'unknown';
  }
}

function sampleForegroundApp(now: number): void {
  if (Date.now() < automationBackoffUntil) {
    if (automationPermission === 'denied') {
      // 已知被拒绝、仍在退避期：不再重复 fork osascript，只是把“未授权”session 的 endTs continue 推进。
      upsertSample(UNAUTHORIZED_APP_LABEL, '', 'other', now);
    }
    return;
  }
  if (awaitingOsascript) return; // 上一次调用还没返回（理论上 timeout 5s < 最短采样间隔 5s，极少发生）
  awaitingOsascript = true;

  execFile('osascript', ['-e', FRONTMOST_APP_SCRIPT], { timeout: OSASCRIPT_TIMEOUT_MS, env: buildOsascriptEnv() }, (error, stdout) => {
    awaitingOsascript = false;
    if (error) {
      handleAutomationFailure(error, now);
      broadcastStatus();
      return;
    }
    consecutiveAutomationFailures = 0;
    automationBackoffUntil = 0;
    automationPermission = 'granted';

    const lines = stdout.split('\n');
    const appName = (lines[0] ?? '').trim() || '(未知应用)';
    let title = (lines[1] ?? '').trim();

    const settings = getSettings();
    if (isExcludedApp(appName, settings.tracking.excludedApps)) {
      title = '';
    }
    const category = categorize(appName, title);
    upsertSample(appName, title, category, now);
    broadcastStatus();
  });
}

function tick(): void {
  if (!running) return;
  const now = Date.now();
  const settings = getSettings();
  lastSampleTs = now;

  if (locked) {
    scheduleNext(settings.tracking.sampleIntervalSec);
    return;
  }

  // 断裂检测：与上一次真正执行 tick 的时间间隔过大（系统睡眠/严重卡顿），旧 session 不应被拉伸覆盖这段空白。
  if (isBreakGap(lastTickAt, now, settings.tracking.sampleIntervalSec)) {
    closeCurrentSession();
  }
  lastTickAt = now;

  const idle = powerMonitor.getSystemIdleTime() >= settings.tracking.idleThresholdSec;
  runtimeIdle = idle;
  if (idle) {
    closeCurrentSession();
    broadcastStatus();
    scheduleNext(settings.tracking.sampleIntervalSec);
    return;
  }

  sampleForegroundApp(now);
  scheduleNext(settings.tracking.sampleIntervalSec);
}

function scheduleNext(sampleIntervalSec: number): void {
  if (!running) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(tick, Math.max(1, sampleIntervalSec) * 1000);
}

function attachPowerMonitorListeners(): void {
  if (listenersAttached) return;
  listenersAttached = true;
  powerMonitor.on('suspend', () => {
    locked = true;
    closeCurrentSession();
    broadcastStatus();
  });
  powerMonitor.on('resume', () => {
    locked = false;
    lastTickAt = Date.now();
    broadcastStatus();
  });
  powerMonitor.on('lock-screen', () => {
    locked = true;
    closeCurrentSession();
    broadcastStatus();
  });
  powerMonitor.on('unlock-screen', () => {
    locked = false;
    lastTickAt = Date.now();
    broadcastStatus();
  });
}

export function startTracker(): void {
  attachPowerMonitorListeners();
  if (running) return;
  running = true;
  lastTickAt = null;
  tick();
  broadcastStatus();
}

export function stopTracker(): void {
  running = false;
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  closeCurrentSession();
  lastSampleTs = null;
  broadcastStatus();
}

export function setTrackingEnabled(enabled: boolean): void {
  if (enabled) startTracker();
  else stopTracker();
}

export function isTrackerRunning(): boolean {
  return running;
}

/** 供 screenshots.ts 判断“本轮是否该跳过截图”：idle / 锁屏或睡眠 / 当前前台应用被排除 三者任一即跳过。 */
export function shouldSkipCaptureNow(): boolean {
  if (!running) return true;
  if (runtimeIdle || locked) return true;
  const settings = getSettings();
  const app = currentSession?.app ?? null;
  if (!app) return false;
  return isExcludedApp(app, settings.tracking.excludedApps);
}

export function getCurrentForegroundApp(): string | null {
  return currentSession?.app ?? null;
}

/** 供 app:clearAllData 使用：DB 全表已被清空，内存里残留的 currentSession.id 会指向一条已不存在
 * 的记录，必须一并丢弃，避免后续 updateSessionEnd 打到一个不存在的 id（虽然无害但语义不对）。 */
export function resetCurrentSession(): void {
  closeCurrentSession();
}

export function getTrackerStatus(): TrackerStatus {
  const settings = getSettings();
  return {
    enabled: running,
    screenshotEnabled: settings.screenshots.enabled,
    idle: runtimeIdle,
    lastSampleTs,
    currentApp: currentSession?.app ?? null,
    permissions: {
      screenRecording: checkScreenRecordingPermission(),
      automation: automationPermission,
    },
  };
}

export function broadcastStatus(): void {
  const status = getTrackerStatus();
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(IPC_CHANNELS.tracker.statusEvent, status);
  }
}
