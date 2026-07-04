// 权限状态检测（只读、无副作用）。为 tracker.ts 的运行时状态（TrackerStatus.permissions）、
// screenshots.ts 的“本轮是否可截图”判断，以及设置页“外观与权限”卡片提供“此刻权限状态是什么”的答案。
import { execFileSync } from 'node:child_process';
import { systemPreferences } from 'electron';
import type { PermissionState } from '../shared/types';

export function checkScreenRecordingPermission(): PermissionState {
  try {
    const status = systemPreferences.getMediaAccessStatus('screen');
    if (status === 'granted') return 'granted';
    if (status === 'denied' || status === 'restricted') return 'denied';
    return 'unknown';
  } catch {
    return 'unknown';
  }
}

let automationCache: { state: PermissionState; ts: number } | null = null;
const AUTOMATION_CACHE_MS = 5000;

/**
 * “自动化”权限没有直接的 Electron 查询 API，用一次轻量 osascript 探测：
 * 成功 -> granted；因权限被拒（错误码 -1743）-> denied；其他异常（如根本没有 System Events 进程）-> unknown。
 * 短时缓存，避免设置页轮询时频繁 fork 进程。
 */
export function checkAutomationPermission(): PermissionState {
  const now = Date.now();
  if (automationCache && now - automationCache.ts < AUTOMATION_CACHE_MS) {
    return automationCache.state;
  }
  let state: PermissionState;
  try {
    execFileSync('osascript', ['-e', 'tell application "System Events" to get name of first process'], {
      timeout: 3000,
      env: { ...process.env, PATH: `${process.env.PATH ?? ''}:/usr/bin:/bin` },
    });
    state = 'granted';
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    state = message.includes('-1743') || message.toLowerCase().includes('not authorized') ? 'denied' : 'unknown';
  }
  automationCache = { state, ts: now };
  return state;
}
