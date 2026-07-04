// 全部 ipcMain.handle 注册处。薄壳：逻辑全部在各模块（tracker/screenshots/git/ai/reports）里，
// 这里只做参数透传、设置持久化联动、以及不便单独成模块的琐碎 app:* 通道。
import fs from 'node:fs';
import { BrowserWindow, app as electronApp, dialog, ipcMain, shell } from 'electron';
import { IPC_CHANNELS } from '../shared/ipc-channels';
import type {
  AnalyzeNowResult,
  Category,
  DeepPartial,
  ExportResult,
  GitCommit,
  HeatmapDay,
  ImageImportResult,
  ImportResult,
  ManualRecord,
  ManualRecordSource,
  MaterialPreview,
  MemoryRefreshPreview,
  MemoryState,
  Note,
  ProviderTestResult,
  Report,
  ReportGenOptions,
  ScheduledReportStatus,
  ScreenshotAnalysis,
  Session,
  Settings,
  StatsOverview,
  TopApp,
  TrackerStatus,
} from '../shared/types';
import { getProvider } from './ai';
import { isClaudeCliAvailable } from './ai/claude-cli';
import { isCodexCliAvailable } from './ai/codex-cli';
import { exportAll, importAll } from './dataTransfer';
import * as db from './db';
import { computeDayStats } from './dayStats';
import { collectCommits } from './git';
import { importImage } from './imageImport';
import { getMemory, refreshMemory, refreshPreview as refreshMemoryPreview, setMemory } from './memory';
import { syncMcpFromSettings } from './mcp/server';
import { resolveScreenshotsDir } from './paths';
import { collectMaterial } from './reports/collect';
import { generateReport } from './reports/generator';
import { getScheduledReportStatus, runScheduledReportNow } from './scheduler';
import { analyzeNow, setScreenshotsEnabled } from './screenshots';
import { getSettings, setSecret, setSettings } from './settings';
import * as stats from './stats';
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

  // v1.3 手动补录 + 自动 session 编辑 + 传图识别（SPEC §17.C）
  ipcMain.handle(
    IPC_CHANNELS.data.addManualRecord,
    async (_event, data: { ts: number; category: Category; title: string; content: string; source: ManualRecordSource }): Promise<ManualRecord> =>
      db.insertManualRecord(data),
  );

  ipcMain.handle(IPC_CHANNELS.data.listManualRecords, async (_event, startTs: number, endTs: number): Promise<ManualRecord[]> =>
    db.listManualRecords(startTs, endTs),
  );

  ipcMain.handle(
    IPC_CHANNELS.data.updateManualRecord,
    async (_event, id: number, patch: { ts?: number; category?: Category; title?: string; content?: string }): Promise<void> => {
      db.updateManualRecord(id, patch);
    },
  );

  ipcMain.handle(IPC_CHANNELS.data.deleteManualRecord, async (_event, id: number): Promise<void> => {
    db.deleteManualRecord(id);
  });

  ipcMain.handle(IPC_CHANNELS.data.updateSessionCategory, async (_event, id: number, category: Category): Promise<void> => {
    db.updateSessionCategory(id, category);
  });

  ipcMain.handle(IPC_CHANNELS.data.deleteSession, async (_event, id: number): Promise<void> => {
    db.deleteSession(id);
  });

  ipcMain.handle(IPC_CHANNELS.data.importImage, async (_event, source: 'clipboard' | 'file'): Promise<ImageImportResult> =>
    importImage(source),
  );

  // ---------------------------------------------------------------------
  // stats（v1.3，SPEC §17.B）
  // ---------------------------------------------------------------------
  ipcMain.handle(IPC_CHANNELS.stats.getOverview, async (): Promise<StatsOverview> => stats.getOverview());

  ipcMain.handle(IPC_CHANNELS.stats.getHeatmap, async (_event, days: number): Promise<HeatmapDay[]> => stats.getHeatmap(days));

  ipcMain.handle(IPC_CHANNELS.stats.getHourMatrix, async (_event, days: number): Promise<number[][]> => stats.getHourMatrix(days));

  ipcMain.handle(IPC_CHANNELS.stats.getTopApps, async (_event, days: number): Promise<TopApp[]> => stats.getTopApps(days));

  ipcMain.handle(
    IPC_CHANNELS.stats.getCategoryTotals,
    async (_event, days: number): Promise<Partial<Record<Category, number>>> => stats.getCategoryTotals(days),
  );

  // ---------------------------------------------------------------------
  // memory（v1.3，SPEC §17.A）
  // ---------------------------------------------------------------------
  ipcMain.handle(IPC_CHANNELS.memory.get, async (): Promise<MemoryState> => getMemory());

  ipcMain.handle(IPC_CHANNELS.memory.update, async (_event, content: string): Promise<MemoryState> => setMemory(content));

  ipcMain.handle(IPC_CHANNELS.memory.refresh, async (): Promise<MemoryState> => refreshMemory());

  ipcMain.handle(IPC_CHANNELS.memory.refreshPreview, async (): Promise<MemoryRefreshPreview> => refreshMemoryPreview());

  // ---------------------------------------------------------------------
  // dataMgmt（v1.3 导出/导入，SPEC §17.D）
  // ---------------------------------------------------------------------
  ipcMain.handle(IPC_CHANNELS.dataMgmt.exportAll, async (): Promise<ExportResult> => exportAll());

  ipcMain.handle(IPC_CHANNELS.dataMgmt.importAll, async (): Promise<ImportResult> => {
    const result = await importAll();
    if (result.ok) {
      // 全表已被替换：丢弃 tracker 内存里指向旧 id 的 currentSession，避免后续 updateSessionEnd 打到不存在的行。
      resetCurrentSession();
    }
    return result;
  });

  // ---------------------------------------------------------------------
  // scheduledReport（v1.3 定时日报，SPEC §17.E）
  // ---------------------------------------------------------------------
  ipcMain.handle(IPC_CHANNELS.scheduledReport.getStatus, async (): Promise<ScheduledReportStatus> => getScheduledReportStatus());

  ipcMain.handle(IPC_CHANNELS.scheduledReport.runNow, async (): Promise<ScheduledReportStatus> => runScheduledReportNow());

  // ---------------------------------------------------------------------
  // capture（v1.3 识别当前屏幕，SPEC §17.F）
  // ---------------------------------------------------------------------
  ipcMain.handle(IPC_CHANNELS.capture.analyzeNow, async (): Promise<AnalyzeNowResult> => analyzeNow());

  // 注意：mcp.* 两个通道由 M2 模块的集成者接线，此处刻意不注册。

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

  ipcMain.handle(IPC_CHANNELS.settings.set, async (_event, patch: DeepPartial<Settings>): Promise<Settings> => {
    const next = setSettings(patch);
    // v1.3：settings.mcp 变更后热启停 MCP Server（幂等，内部只在状态变化时动作）。
    syncMcpFromSettings();
    return next;
  });

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
