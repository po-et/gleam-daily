// 全部 ipcMain.handle 注册处。薄壳：逻辑全部在各模块（tracker/screenshots/git/ai/reports）里，
// 这里只做参数透传、设置持久化联动、以及不便单独成模块的琐碎 app:* 通道。
import fs from 'node:fs';
import { BrowserWindow, app as electronApp, dialog, ipcMain, shell } from 'electron';
import { IPC_CHANNELS } from '../shared/ipc-channels';
import type {
  DeepPartial,
  GitCommit,
  MaterialPreview,
  Note,
  ProviderTestResult,
  Report,
  ReportGenOptions,
  ScreenshotAnalysis,
  Session,
  Settings,
  TrackerStatus,
} from '../shared/types';
import { getProvider } from './ai';
import { isClaudeCliAvailable } from './ai/claude-cli';
import { isCodexCliAvailable } from './ai/codex-cli';
import * as db from './db';
import { computeDayStats } from './dayStats';
import { collectCommits } from './git';
import { resolveScreenshotsDir } from './paths';
import { collectMaterial } from './reports/collect';
import { generateReport } from './reports/generator';
import { setScreenshotsEnabled } from './screenshots';
import { getSettings, setSecret, setSettings } from './settings';
import { broadcastStatus as broadcastTrackerStatus, getTrackerStatus, resetCurrentSession, setTrackingEnabled } from './tracker';

export function registerIpcHandlers(): void {
  // ---------------------------------------------------------------------
  // tracker（真实实现：状态来自 tracker.ts 的运行时采样循环）
  // ---------------------------------------------------------------------
  ipcMain.handle(IPC_CHANNELS.tracker.getStatus, async (): Promise<TrackerStatus> => getTrackerStatus());

  ipcMain.handle(IPC_CHANNELS.tracker.setEnabled, async (_event, enabled: boolean): Promise<void> => {
    setSettings({ tracking: { enabled } });
    setTrackingEnabled(enabled); // 内部会自行 broadcastStatus
  });

  ipcMain.handle(IPC_CHANNELS.tracker.setScreenshotEnabled, async (_event, enabled: boolean): Promise<void> => {
    setSettings({ screenshots: { enabled } });
    setScreenshotsEnabled(enabled);
    broadcastTrackerStatus(); // TrackerStatus.screenshotEnabled 需要跟着刷新
  });

  // ---------------------------------------------------------------------
  // data
  // ---------------------------------------------------------------------
  ipcMain.handle(IPC_CHANNELS.data.getSessions, async (_event, startTs: number, endTs: number): Promise<Session[]> =>
    db.getSessions(startTs, endTs),
  );

  ipcMain.handle(IPC_CHANNELS.data.getDayStats, async (_event, date: string) => {
    const dayStart = new Date(`${date}T00:00:00`).getTime();
    const dayEnd = dayStart + 24 * 60 * 60 * 1000;
    const sessions = db.getSessions(dayStart, dayEnd);
    return computeDayStats(date, sessions);
  });

  ipcMain.handle(
    IPC_CHANNELS.data.getScreenshotAnalyses,
    async (_event, startTs: number, endTs: number): Promise<ScreenshotAnalysis[]> => db.getScreenshotAnalyses(startTs, endTs),
  );

  ipcMain.handle(IPC_CHANNELS.data.addNote, async (_event, content: string): Promise<Note> => db.addNote(content));

  ipcMain.handle(IPC_CHANNELS.data.listNotes, async (_event, startTs: number, endTs: number): Promise<Note[]> =>
    db.listNotes(startTs, endTs),
  );

  ipcMain.handle(IPC_CHANNELS.data.deleteNote, async (_event, id: number): Promise<void> => {
    db.deleteNote(id);
  });

  ipcMain.handle(IPC_CHANNELS.data.collectCommits, async (_event, startTs: number, endTs: number): Promise<GitCommit[]> =>
    collectCommits(startTs, endTs),
  );

  // ---------------------------------------------------------------------
  // reports
  // ---------------------------------------------------------------------
  ipcMain.handle(IPC_CHANNELS.reports.preview, async (_event, opts: ReportGenOptions): Promise<MaterialPreview> => {
    const material = await collectMaterial(opts);
    return material.preview;
  });

  ipcMain.handle(IPC_CHANNELS.reports.generate, async (_event, opts: ReportGenOptions): Promise<void> => {
    // 故意不 await：采集 + AI 调用可能耗时数十秒到 3 分钟，全部结果经 reports:progress 事件推送，
    // 与 preload 契约注释「结果经 onProgress 回来」一致，调用方不需要也不应该拿这个 Promise 阻塞 UI。
    void generateReport(opts);
  });

  ipcMain.handle(IPC_CHANNELS.reports.list, async (): Promise<Report[]> => db.listReports());

  ipcMain.handle(IPC_CHANNELS.reports.get, async (_event, id: number): Promise<Report | null> => db.getReport(id));

  ipcMain.handle(IPC_CHANNELS.reports.update, async (_event, id: number, contentMd: string): Promise<void> => {
    db.updateReport(id, contentMd);
  });

  ipcMain.handle(IPC_CHANNELS.reports.remove, async (_event, id: number): Promise<void> => {
    db.deleteReport(id);
  });

  // ---------------------------------------------------------------------
  // settings
  // ---------------------------------------------------------------------
  ipcMain.handle(IPC_CHANNELS.settings.get, async (): Promise<Settings> => getSettings());

  ipcMain.handle(IPC_CHANNELS.settings.set, async (_event, patch: DeepPartial<Settings>): Promise<Settings> => setSettings(patch));

  ipcMain.handle(IPC_CHANNELS.settings.setSecret, async (_event, which: 'anthropic' | 'openaiCompat', key: string): Promise<void> => {
    setSecret(which, key);
  });

  ipcMain.handle(IPC_CHANNELS.settings.testProvider, async (): Promise<ProviderTestResult> => {
    try {
      return await getProvider(getSettings()).test();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, message };
    }
  });

  ipcMain.handle(IPC_CHANNELS.settings.pickDirectory, async (event): Promise<string | null> => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const dialogOptions: Electron.OpenDialogOptions = { properties: ['openDirectory', 'createDirectory'] };
    const result = win ? await dialog.showOpenDialog(win, dialogOptions) : await dialog.showOpenDialog(dialogOptions);
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0] ?? null;
  });

  // ---------------------------------------------------------------------
  // app
  // ---------------------------------------------------------------------
  ipcMain.handle(IPC_CHANNELS.app.getVersion, async (): Promise<string> => electronApp.getVersion());

  ipcMain.handle(IPC_CHANNELS.app.openExternal, async (_event, url: string): Promise<void> => {
    await shell.openExternal(url);
  });

  ipcMain.handle(
    IPC_CHANNELS.app.openPermissionSettings,
    async (_event, which: 'screenRecording' | 'automation' | 'accessibility'): Promise<void> => {
      const paneMap: Record<typeof which, string> = {
        screenRecording: 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
        automation: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Automation',
        accessibility: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
      };
      await shell.openExternal(paneMap[which]);
    },
  );

  ipcMain.handle(IPC_CHANNELS.app.clearAllData, async (): Promise<void> => {
    db.clearAllData();
    resetCurrentSession();
    const dir = resolveScreenshotsDir();
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } finally {
      fs.mkdirSync(dir, { recursive: true });
    }
  });

  ipcMain.handle(IPC_CHANNELS.app.isClaudeCliAvailable, async (): Promise<boolean> => isClaudeCliAvailable());

  ipcMain.handle(IPC_CHANNELS.app.isCodexCliAvailable, async (): Promise<boolean> => isCodexCliAvailable());

  ipcMain.handle(IPC_CHANNELS.app.getDataDir, async (): Promise<string> => electronApp.getPath('userData'));

  ipcMain.handle(IPC_CHANNELS.app.showDataDir, async (): Promise<void> => {
    await shell.openPath(electronApp.getPath('userData'));
  });
}
