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
  report: { defaultTemplate: ReportTemplate };
}

export interface ReportGenOptions {
  type: ReportType;
  date: string; // daily: 该日; weekly: 该周任一天; monthly: 该月任一天
  template: ReportTemplate;
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
