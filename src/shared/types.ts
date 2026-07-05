// 【契约】共享类型定义。逐字对应 docs/SPEC.md §4。
// main / preload / renderer 三层都从这里导入，禁止在各层重复定义或漂移。

export type Category = 'dev' | 'meeting' | 'comm' | 'docs' | 'design' | 'research' | 'leisure' | 'other';

export interface Session {
  id: number;
  startTs: number; // epoch ms
  endTs: number;
  app: string;
  title: string; // 窗口标题，可为 ''
  category: Category;
}

export interface ScreenshotAnalysis {
  id: number;
  ts: number;
  status: 'pending' | 'analyzed' | 'failed' | 'skipped';
  summary: string; // AI 一句话描述，skipped/failed 时为 ''
  category: Category | null;
  app: string; // 截图时的前台应用
}

export interface Note {
  id: number;
  ts: number;
  content: string;
}

// --- v1.3 手动记录（SPEC §17.C）---

export type ManualRecordSource = 'manual' | 'image';

export interface ManualRecord {
  id: number;
  ts: number; // 记录时间点（用户可改）
  category: Category;
  title: string; // 可为 ''
  content: string;
  source: ManualRecordSource;
}

export type ImageImportResult =
  | { ok: true; record: ManualRecord }
  | { ok: false; reason: 'empty-clipboard' | 'cancelled' | 'sensitive' | 'failed'; message: string };

export interface GitCommit {
  id: number;
  repo: string;
  hash: string;
  ts: number;
  message: string;
  filesChanged: number;
  insertions: number;
  deletions: number;
}

export type ReportType = 'daily' | 'weekly' | 'monthly';
export type ReportTemplate = 'standard' | 'concise' | 'technical' | 'okr';
/** v1.4：详略等级，与模板正交（模板管结构，详略管展开度）。 */
export type ReportDetailLevel = 'concise' | 'standard' | 'rich';

export interface Report {
  id: number;
  type: ReportType;
  template: ReportTemplate;
  periodStart: string; // 'YYYY-MM-DD'
  periodEnd: string;
  contentMd: string;
  model: string;
  createdTs: number;
}

export interface FocusBlock {
  startTs: number;
  endTs: number;
  category: Category;
}

export interface DayStats {
  date: string; // 'YYYY-MM-DD'
  totalActiveMs: number;
  byCategory: Partial<Record<Category, number>>; // ms
  topApps: { app: string; ms: number }[]; // 前 8
  contextSwitches: number; // 相邻 session 应用变化次数
  focusBlocks: FocusBlock[]; // 同类连续 >= 25min
}

// --- v1.3 统计（SPEC §17.B）---

export interface StatsOverview {
  streakDays: number; // 截至今天（或昨天）连续有记录的天数
  totalActiveDays: number;
  avgDailyActiveMs30d: number; // 近 30 天有记录日的平均活跃时长
  totalSessions: number;
  totalScreenshots: number;
  totalReports: number;
}

export interface HeatmapDay {
  date: string; // 'YYYY-MM-DD'，连续无空洞
  activeMs: number;
}

export interface TopApp {
  app: string;
  ms: number;
  category: Category; // 该 app 时长最多的分类
}

// --- v1.4 应用记录（SPEC §18.A）---

export type AppUsagePeriod = 'today' | 'week' | 'month' | '30d';

export interface AppUsageRow {
  app: string;
  ms: number;
  pct: number; // 占 totalMs 百分比（0-100，原始数值，格式化交给渲染层）
  category: Category;
  firstTs: number; // 周期内该 app 首个 session 开始
  lastTs: number; // 周期内该 app 最后一个 session 结束
}

export interface AppUsageSummary {
  period: AppUsagePeriod;
  totalApps: number;
  totalMs: number;
  avgDailyMs: number; // totalMs / 周期内有记录的天数
  apps: AppUsageRow[]; // 按 ms 降序，全量（截断是 UI 的事）
}

// --- v1.3 记忆（SPEC §17.A）---

export interface MemoryState {
  content: string; // markdown，可为 ''
  updatedTs: number; // 0 = 从未生成
}

export interface MemoryRefreshPreview {
  sessionCount: number;
  screenshotCount: number;
  noteCount: number;
  commitCount: number;
  charCount: number; // 素材总字数（截断前）
}

// --- v1.3 导出导入（SPEC §17.D）---

export interface ExportResult {
  ok: boolean;
  path?: string;
  message?: string; // 取消时 ok:false 且 message ''
}

export interface ImportResult {
  ok: boolean;
  message: string;
  counts?: Record<string, number>;
}

// --- v1.3 定时日报（SPEC §17.E）---

export interface ScheduledReportStatus {
  lastRunDate: string | null; // 'YYYY-MM-DD'
  lastResult: 'success' | 'failed' | 'skipped' | null;
  lastMessage: string;
  nextRunAt: number | null; // enabled 时下一次触发 epoch ms
}

// --- v1.3 识别当前屏幕（SPEC §17.F）---

export type AnalyzeNowResult =
  | { ok: true; analysis: ScreenshotAnalysis }
  | { ok: false; reason: string }; // 无权限/敏感熔断/分析失败等，直接给用户可读文案

// --- v1.3 MCP（SPEC §17.G）---

export interface McpStatus {
  running: boolean;
  port: number;
  url: string; // running 时 http://127.0.0.1:{port}/mcp，否则 ''
  error: string; // 端口占用等启动失败原因
}

export interface McpLogEntry {
  ts: number;
  tool: string;
  argsJson: string;
  ok: boolean;
  durationMs: number;
}

export type PermissionState = 'granted' | 'denied' | 'unknown';

export interface TrackerStatus {
  enabled: boolean;
  screenshotEnabled: boolean;
  idle: boolean;
  lastSampleTs: number | null;
  currentApp: string | null;
  permissions: { screenRecording: PermissionState; automation: PermissionState };
}

export type AiProviderKind = 'claude-cli' | 'codex-cli' | 'anthropic' | 'openai-compat';

export interface Settings {
  theme: 'system' | 'light' | 'dark';
  tracking: {
    enabled: boolean;
    sampleIntervalSec: number; // 默认 10
    idleThresholdSec: number; // 默认 180
    excludedApps: string[];
  };
  screenshots: {
    enabled: boolean; // 默认 true（截图→AI 提炼→删图，产品核心体验）
    intervalMin: number; // 默认 5
    keepAfterAnalysis: boolean; // 默认 false
  };
  git: { repoPaths: string[]; scanRoots: string[]; authorFilter: string };
  ai: {
    provider: AiProviderKind;
    anthropic: { hasKey: boolean; keyMasked: string; model: string }; // 默认 model 'claude-sonnet-5'
    claudeCli: { model: string }; // 默认 'sonnet'
    codexCli: { model: string }; // 默认 ''（留空 = codex 内置默认模型）；文本与视觉共用
    openaiCompat: { baseUrl: string; hasKey: boolean; keyMasked: string; model: string };
    visionModel: string; // 截图分析用，默认 'claude-haiku-4-5-20251001'（cli 时用 'haiku'）
    roleContext: string; // 用户角色描述，拼入 prompt
  };
  report: { defaultTemplate: ReportTemplate; defaultDetail: ReportDetailLevel }; // defaultDetail 默认 'standard'
  memory: {
    enabled: boolean; // 默认 true
    injectToVision: boolean; // 默认 true
    injectToReports: boolean; // 默认 true
    autoRefresh: 'off' | 'daily' | 'weekly'; // 默认 'weekly'
  };
  scheduledReport: {
    enabled: boolean; // 默认 false
    time: string; // 'HH:mm'，默认 '18:00'
    template: ReportTemplate; // 默认 'standard'
    extraInstructions: string;
  };
  mcp: {
    enabled: boolean; // 默认 false（隐私红线：显式开启才对外暴露本机数据）
    port: number; // 默认 41414，仅绑定 127.0.0.1
  };
}

export interface ReportGenOptions {
  type: ReportType;
  date: string; // daily: 该日; weekly: 该周任一天; monthly: 该月任一天
  template: ReportTemplate;
  detail?: ReportDetailLevel; // v1.4：缺省取 settings.report.defaultDetail
  extraInstructions?: string;
}

export type ReportProgress =
  | { stage: 'collecting' }
  | { stage: 'generating' }
  | { stage: 'done'; reportId: number }
  | { stage: 'error'; message: string };

export interface ProviderTestResult {
  ok: boolean;
  message: string;
  latencyMs?: number;
}

export interface MaterialPreview {
  // 生成前给用户看素材规模
  sessionCount: number;
  activeMs: number;
  screenshotCount: number;
  commitCount: number;
  noteCount: number;
  manualRecordCount: number; // v1.3：手动补录条数
  dailyReportCount: number; // weekly/monthly 时复用的日报数
}

/** 深度 Partial，用于 settings:set 的 patch 参数。函数类型与非对象类型原样保留。 */
export type DeepPartial<T> = T extends (...args: unknown[]) => unknown
  ? T
  : T extends readonly (infer U)[]
    ? T extends unknown[]
      ? DeepPartial<U>[]
      : readonly DeepPartial<U>[]
    : T extends object
      ? { [K in keyof T]?: DeepPartial<T[K]> }
      : T;
