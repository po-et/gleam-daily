// contextBridge 暴露 window.gleam（见 docs/SPEC.md §5）。渲染层永远只能通过这个白名单 API 触达主进程。
import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS } from '../shared/ipc-channels';
import type {
  DeepPartial,
  GitCommit,
  MaterialPreview,
  Note,
  ProviderTestResult,
  Report,
  ReportGenOptions,
  ReportProgress,
  ScreenshotAnalysis,
  Session,
  Settings,
  TrackerStatus,
  DayStats,
} from '../shared/types';

function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_event: Electron.IpcRendererEvent, payload: T): void => cb(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

const gleamApi = {
  tracker: {
    getStatus: (): Promise<TrackerStatus> => ipcRenderer.invoke(IPC_CHANNELS.tracker.getStatus),
    setEnabled: (b: boolean): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.tracker.setEnabled, b),
    setScreenshotEnabled: (b: boolean): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.tracker.setScreenshotEnabled, b),
    onStatus: (cb: (s: TrackerStatus) => void): (() => void) => subscribe<TrackerStatus>(IPC_CHANNELS.tracker.statusEvent, cb),
  },
  data: {
    getSessions: (startTs: number, endTs: number): Promise<Session[]> =>
      ipcRenderer.invoke(IPC_CHANNELS.data.getSessions, startTs, endTs),
    getDayStats: (date: string): Promise<DayStats> => ipcRenderer.invoke(IPC_CHANNELS.data.getDayStats, date),
    getScreenshotAnalyses: (startTs: number, endTs: number): Promise<ScreenshotAnalysis[]> =>
      ipcRenderer.invoke(IPC_CHANNELS.data.getScreenshotAnalyses, startTs, endTs),
    addNote: (content: string): Promise<Note> => ipcRenderer.invoke(IPC_CHANNELS.data.addNote, content),
    listNotes: (startTs: number, endTs: number): Promise<Note[]> => ipcRenderer.invoke(IPC_CHANNELS.data.listNotes, startTs, endTs),
    deleteNote: (id: number): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.data.deleteNote, id),
    collectCommits: (startTs: number, endTs: number): Promise<GitCommit[]> =>
      ipcRenderer.invoke(IPC_CHANNELS.data.collectCommits, startTs, endTs),
  },
  reports: {
    preview: (opts: ReportGenOptions): Promise<MaterialPreview> => ipcRenderer.invoke(IPC_CHANNELS.reports.preview, opts),
    generate: (opts: ReportGenOptions): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.reports.generate, opts),
    onProgress: (cb: (p: ReportProgress) => void): (() => void) => subscribe<ReportProgress>(IPC_CHANNELS.reports.progressEvent, cb),
    list: (): Promise<Report[]> => ipcRenderer.invoke(IPC_CHANNELS.reports.list),
    get: (id: number): Promise<Report | null> => ipcRenderer.invoke(IPC_CHANNELS.reports.get, id),
    update: (id: number, contentMd: string): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.reports.update, id, contentMd),
    remove: (id: number): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.reports.remove, id),
  },
  settings: {
    get: (): Promise<Settings> => ipcRenderer.invoke(IPC_CHANNELS.settings.get),
    set: (patch: DeepPartial<Settings>): Promise<Settings> => ipcRenderer.invoke(IPC_CHANNELS.settings.set, patch),
    setSecret: (which: 'anthropic' | 'openaiCompat', key: string): Promise<void> =>
      ipcRenderer.invoke(IPC_CHANNELS.settings.setSecret, which, key),
    testProvider: (): Promise<ProviderTestResult> => ipcRenderer.invoke(IPC_CHANNELS.settings.testProvider),
    pickDirectory: (): Promise<string | null> => ipcRenderer.invoke(IPC_CHANNELS.settings.pickDirectory),
  },
  app: {
    getVersion: (): Promise<string> => ipcRenderer.invoke(IPC_CHANNELS.app.getVersion),
    openExternal: (url: string): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.app.openExternal, url),
    openPermissionSettings: (which: 'screenRecording' | 'automation' | 'accessibility'): Promise<void> =>
      ipcRenderer.invoke(IPC_CHANNELS.app.openPermissionSettings, which),
    clearAllData: (): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.app.clearAllData),
    isClaudeCliAvailable: (): Promise<boolean> => ipcRenderer.invoke(IPC_CHANNELS.app.isClaudeCliAvailable),
    isCodexCliAvailable: (): Promise<boolean> => ipcRenderer.invoke(IPC_CHANNELS.app.isCodexCliAvailable),
    getDataDir: (): Promise<string> => ipcRenderer.invoke(IPC_CHANNELS.app.getDataDir),
    showDataDir: (): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.app.showDataDir),
  },
};

export type GleamApi = typeof gleamApi;

contextBridge.exposeInMainWorld('gleam', gleamApi);
