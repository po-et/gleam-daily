// 设置页（DESIGN §6）：记录 / 屏幕分析 / Git / AI 引擎 / 外观与权限 / 数据 六组卡片 + 页脚。
// 所有变更即时持久化：开关/下拉/分段即时 settings.set；文本输入失焦保存。对空数据/桩返回值健壮。
import { useCallback, useEffect, useMemo, useState, type JSX } from 'react';
import type {
  AiProviderKind,
  DeepPartial,
  McpLogEntry,
  McpStatus,
  MemoryRefreshPreview,
  MemoryState,
  PermissionState,
  ReportTemplate,
  ScheduledReportStatus,
  Settings,
  TrackerStatus,
} from '@shared/types';
import { api } from '../api';
import Card from '../components/Card';
import Button from '../components/Button';
import Switch from '../components/Switch';
import SegmentControl from '../components/SegmentControl';
import Modal from '../components/Modal';
import { FieldRow, Input, Select, TagInput, Textarea } from '../components/FormControls';
import { useToast } from '../components/Toast';
import { IconChevronDown, IconCopy, IconDownload, IconExternalLink, IconTrash } from '../components/icons';
import { applyTheme } from '../lib/theme';
import { formatClockTime } from '../lib/format';
import { useInterval } from '../lib/hooks';
import './Settings.css';

const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  tracking: { enabled: false, sampleIntervalSec: 10, idleThresholdSec: 180, excludedApps: [] },
  screenshots: { enabled: false, intervalMin: 5, keepAfterAnalysis: false, keepDays: 0 },
  git: { repoPaths: [], scanRoots: [], authorFilter: '' },
  ai: {
    provider: 'claude-cli',
    anthropic: { hasKey: false, keyMasked: '', model: 'claude-sonnet-5' },
    claudeCli: { model: 'sonnet' },
    codexCli: { model: '' },
    openaiCompat: { baseUrl: '', hasKey: false, keyMasked: '', model: '' },
    visionModel: 'claude-haiku-4-5-20251001',
    roleContext: '',
  },
  report: { defaultTemplate: 'standard', defaultDetail: 'standard' },
  memory: { enabled: true, injectToVision: true, injectToReports: true, autoRefresh: 'weekly' },
  scheduledReport: { enabled: false, time: '18:00', template: 'standard', extraInstructions: '' },
  mcp: { enabled: false, port: 41414 },
};

const SAMPLE_OPTIONS = [
  { value: '5', label: '5 秒' },
  { value: '10', label: '10 秒' },
  { value: '15', label: '15 秒' },
  { value: '30', label: '30 秒' },
];

const IDLE_OPTIONS = [
  { value: '60', label: '1 分钟' },
  { value: '180', label: '3 分钟' },
  { value: '300', label: '5 分钟' },
  { value: '600', label: '10 分钟' },
];

const SHOT_INTERVAL_OPTIONS = [
  { value: '3', label: '3 分钟' },
  { value: '5', label: '5 分钟' },
  { value: '10', label: '10 分钟' },
  { value: '15', label: '15 分钟' },
];

// v1.4.1：保留原始截图的期限。0 = 不限期（默认，不悄悄删用户留的图）。
const KEEP_DAYS_OPTIONS = [
  { value: '0', label: '不限期' },
  { value: '7', label: '保留 7 天' },
  { value: '30', label: '保留 30 天' },
  { value: '90', label: '保留 90 天' },
];

const THEME_OPTIONS: { value: Settings['theme']; label: string }[] = [
  { value: 'system', label: '跟随系统' },
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
];

const PROVIDERS: { kind: AiProviderKind; name: string; desc: string }[] = [
  { kind: 'claude-cli', name: 'Claude Code CLI', desc: '推荐，使用本机已登录的 Claude Code，无需 API Key' },
  { kind: 'codex-cli', name: 'Codex CLI', desc: '使用本机已登录的 Codex CLI，无需 API Key' },
  { kind: 'anthropic', name: 'Anthropic API', desc: '自备 Key 直连' },
  { kind: 'openai-compat', name: 'OpenAI 兼容', desc: '任意兼容端点' },
];

const PERMISSION_TEXT: Record<PermissionState, string> = {
  granted: '已授权',
  denied: '未授权',
  unknown: '未知',
};

const AUTO_REFRESH_OPTIONS: { value: Settings['memory']['autoRefresh']; label: string }[] = [
  { value: 'off', label: '关闭' },
  { value: 'daily', label: '每天' },
  { value: 'weekly', label: '每周' },
];

const TEMPLATE_OPTIONS: { value: ReportTemplate; label: string }[] = [
  { value: 'standard', label: '标准' },
  { value: 'concise', label: '简洁' },
  { value: 'technical', label: '技术' },
  { value: 'okr', label: 'OKR' },
];

/** epoch ms -> "M月D日 HH:mm"，0 表示从未。 */
function formatStamp(ts: number): string {
  if (!ts) return '从未';
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${d.getMonth() + 1}月${d.getDate()}日 ${hh}:${mm}`;
}

function schedStatusLine(st: ScheduledReportStatus | null): string {
  const next = st?.nextRunAt ? `　下次 ${formatStamp(st.nextRunAt)}` : '';
  if (!st || st.lastResult === null) return `尚未运行${next}`;
  const label = st.lastResult === 'success' ? '成功' : st.lastResult === 'failed' ? '失败' : '跳过';
  const when = st.lastRunDate ? ` · ${st.lastRunDate}` : '';
  const msg = st.lastMessage ? ` · ${st.lastMessage}` : '';
  return `上次：${label}${when}${msg}${next}`;
}

// preload 契约里没有暴露数据目录相关方法；若主进程未来扩展了这些可选方法，运行时探测后使用，否则优雅降级。
type AppExtra = { getDataDir?: () => Promise<string>; showDataDir?: () => Promise<void> };

interface TestState {
  status: 'idle' | 'testing' | 'ok' | 'error';
  message: string;
  latencyMs?: number;
}

function SecretField({
  hasKey,
  keyMasked,
  onSave,
}: {
  hasKey: boolean;
  keyMasked: string;
  onSave: (key: string) => Promise<void>;
}): JSX.Element {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);

  if (hasKey && !editing) {
    return (
      <div className="gd-secret">
        <span className="gd-secret__mask gd-mono">{'•'.repeat(6)}{keyMasked || '••••'}</span>
        <Button size="sm" variant="secondary" onClick={() => { setDraft(''); setEditing(true); }}>
          更换
        </Button>
      </div>
    );
  }

  async function save(): Promise<void> {
    const key = draft.trim();
    if (!key) return;
    setSaving(true);
    try {
      await onSave(key);
      setDraft('');
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="gd-secret">
      <Input
        type="password"
        value={draft}
        placeholder="粘贴 API Key"
        onChange={(e) => setDraft(e.target.value)}
        style={{ width: 190 }}
      />
      <Button size="sm" variant="primary" loading={saving} disabled={!draft.trim()} onClick={() => void save()}>
        保存
      </Button>
      {hasKey ? (
        <Button size="sm" variant="ghost" onClick={() => { setDraft(''); setEditing(false); }}>
          取消
        </Button>
      ) : null}
    </div>
  );
}

export default function SettingsPage(): JSX.Element {
  const { showToast } = useToast();
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [permissions, setPermissions] = useState<TrackerStatus['permissions']>({
    screenRecording: 'unknown',
    automation: 'unknown',
  });
  const [cliAvailable, setCliAvailable] = useState(true);
  const [codexAvailable, setCodexAvailable] = useState(true);
  const [version, setVersion] = useState('');
  const [dataDir, setDataDir] = useState<string | null>(null);
  const [test, setTest] = useState<TestState>({ status: 'idle', message: '' });
  const [clearOpen, setClearOpen] = useState(false);
  const [clearing, setClearing] = useState(false);

  // v1.3：AI 记忆
  const [memory, setMemory] = useState<MemoryState>({ content: '', updatedTs: 0 });
  const [memDraft, setMemDraft] = useState('');
  const [memEditorOpen, setMemEditorOpen] = useState(false);
  const [memPreview, setMemPreview] = useState<MemoryRefreshPreview | null>(null);
  const [memConfirmOpen, setMemConfirmOpen] = useState(false);
  const [memRefreshing, setMemRefreshing] = useState(false);
  const [memSaving, setMemSaving] = useState(false);

  // v1.3：定时日报
  const [schedStatus, setSchedStatus] = useState<ScheduledReportStatus | null>(null);
  const [schedRunning, setSchedRunning] = useState(false);

  // v1.3：数据导出/导入
  const [exporting, setExporting] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importing, setImporting] = useState(false);

  // v1.3：MCP
  const [mcpStatus, setMcpStatus] = useState<McpStatus | null>(null);
  const [mcpLogs, setMcpLogs] = useState<McpLogEntry[]>([]);
  const [logsOpen, setLogsOpen] = useState(false);

  const appExtra = useMemo(() => api.app as unknown as AppExtra, []);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const s = await api.settings.get();
      setSettings(s);
    } catch {
      // 主进程桩未就绪：保留默认设置，页面照常可交互，绝不白屏。
    }
  }, []);

  useEffect(() => {
    void refresh();
    void (async () => {
      try {
        const status = await api.tracker.getStatus();
        setPermissions(status.permissions);
      } catch {
        /* ignore */
      }
    })();
    void api.app.isClaudeCliAvailable().then(setCliAvailable).catch(() => setCliAvailable(false));
    void api.app.isCodexCliAvailable().then(setCodexAvailable).catch(() => setCodexAvailable(false));
    void api.app.getVersion().then(setVersion).catch(() => setVersion(''));
    void api.memory
      .get()
      .then((m) => {
        setMemory(m);
        setMemDraft(m.content);
      })
      .catch(() => {});
    void api.scheduledReport.getStatus().then(setSchedStatus).catch(() => {});
    void api.mcp.getStatus().then(setMcpStatus).catch(() => {});
    if (appExtra.getDataDir) {
      void appExtra.getDataDir().then(setDataDir).catch(() => setDataDir(null));
    }
    const unsubscribe = api.tracker.onStatus((s) => {
      setPermissions(s.permissions);
      // 记录/截图开关可能从侧栏或托盘改动，这里同步反映到设置页开关。
      setSettings((prev) => ({
        ...prev,
        tracking: { ...prev.tracking, enabled: s.enabled },
        screenshots: { ...prev.screenshots, enabled: s.screenshotEnabled },
      }));
    });
    return unsubscribe;
  }, [refresh, appExtra]);

  // 本地乐观更新 + 持久化。桩未就绪时 set 静默失败，本地状态已生效。
  const persist = useCallback((patch: DeepPartial<Settings>): void => {
    api.settings.set(patch).catch(() => {});
  }, []);

  const commit = useCallback(
    (next: Settings, patch: DeepPartial<Settings>): void => {
      setSettings(next);
      persist(patch);
    },
    [persist],
  );

  // MCP 运行状态每 5s 轮询；请求日志仅在展开时刷新。
  useInterval(() => {
    void api.mcp.getStatus().then(setMcpStatus).catch(() => {});
    if (logsOpen) void api.mcp.getLogs().then(setMcpLogs).catch(() => {});
  }, 5000);

  // ---- 记录 ----
  function toggleTracking(enabled: boolean): void {
    setSettings((prev) => ({ ...prev, tracking: { ...prev.tracking, enabled } }));
    api.tracker.setEnabled(enabled).catch(() => {});
  }

  // ---- 屏幕分析 ----
  function toggleScreenshots(enabled: boolean): void {
    setSettings((prev) => ({ ...prev, screenshots: { ...prev.screenshots, enabled } }));
    api.tracker.setScreenshotEnabled(enabled).catch(() => {});
  }

  // ---- Git ----
  async function addRepo(): Promise<void> {
    try {
      const dir = await api.settings.pickDirectory();
      if (!dir || settings.git.repoPaths.includes(dir)) return;
      const repoPaths = [...settings.git.repoPaths, dir];
      commit({ ...settings, git: { ...settings.git, repoPaths } }, { git: { repoPaths } });
    } catch {
      /* ignore */
    }
  }

  async function addScanRoot(): Promise<void> {
    try {
      const dir = await api.settings.pickDirectory();
      if (!dir || settings.git.scanRoots.includes(dir)) return;
      const scanRoots = [...settings.git.scanRoots, dir];
      commit({ ...settings, git: { ...settings.git, scanRoots } }, { git: { scanRoots } });
    } catch {
      /* ignore */
    }
  }

  function removeRepo(path: string): void {
    const repoPaths = settings.git.repoPaths.filter((p) => p !== path);
    commit({ ...settings, git: { ...settings.git, repoPaths } }, { git: { repoPaths } });
  }

  function removeScanRoot(path: string): void {
    const scanRoots = settings.git.scanRoots.filter((p) => p !== path);
    commit({ ...settings, git: { ...settings.git, scanRoots } }, { git: { scanRoots } });
  }

  // ---- AI ----
  function selectProvider(provider: AiProviderKind): void {
    commit({ ...settings, ai: { ...settings.ai, provider } }, { ai: { provider } });
    setTest({ status: 'idle', message: '' });
  }

  async function saveSecret(which: 'anthropic' | 'openaiCompat', key: string): Promise<void> {
    try {
      await api.settings.setSecret(which, key);
      showToast('API Key 已加密保存', 'success');
      await refresh();
    } catch {
      showToast('保存 Key 失败，请重试', 'error');
    }
  }

  async function runTest(): Promise<void> {
    setTest({ status: 'testing', message: '正在测试连接…' });
    try {
      const result = await api.settings.testProvider();
      setTest(
        result.ok
          ? { status: 'ok', message: result.message || '连接正常', latencyMs: result.latencyMs }
          : { status: 'error', message: result.message || '连接失败' },
      );
    } catch (e) {
      setTest({ status: 'error', message: e instanceof Error ? e.message : '连接失败，请检查配置与网络' });
    }
  }

  // ---- 外观 ----
  function selectTheme(theme: Settings['theme']): void {
    applyTheme(theme); // 即时生效
    commit({ ...settings, theme }, { theme });
  }

  async function openPerm(which: 'automation' | 'screenRecording'): Promise<void> {
    try {
      await api.app.openPermissionSettings(which);
    } catch {
      showToast('无法打开系统设置', 'error');
    }
  }

  // ---- 数据 ----
  async function revealData(): Promise<void> {
    try {
      if (appExtra.showDataDir) {
        await appExtra.showDataDir();
        return;
      }
      if (dataDir) {
        await api.app.openExternal(`file://${dataDir}`);
        return;
      }
      showToast('暂时无法定位数据目录', 'error');
    } catch {
      showToast('无法打开数据目录', 'error');
    }
  }

  async function confirmClear(): Promise<void> {
    setClearing(true);
    try {
      await api.app.clearAllData();
      setClearOpen(false);
      showToast('已清除所有数据', 'success');
      await refresh();
    } catch {
      showToast('清除失败，请重试', 'error');
    } finally {
      setClearing(false);
    }
  }

  // ---- AI 记忆 ----
  function toggleMemory(enabled: boolean): void {
    commit({ ...settings, memory: { ...settings.memory, enabled } }, { memory: { enabled } });
  }
  function setMemoryVision(injectToVision: boolean): void {
    commit({ ...settings, memory: { ...settings.memory, injectToVision } }, { memory: { injectToVision } });
  }
  function setMemoryReports(injectToReports: boolean): void {
    commit({ ...settings, memory: { ...settings.memory, injectToReports } }, { memory: { injectToReports } });
  }
  function setAutoRefresh(autoRefresh: Settings['memory']['autoRefresh']): void {
    commit({ ...settings, memory: { ...settings.memory, autoRefresh } }, { memory: { autoRefresh } });
  }
  async function openMemoryRefresh(): Promise<void> {
    try {
      const p = await api.memory.refreshPreview();
      setMemPreview(p);
      setMemConfirmOpen(true);
    } catch {
      showToast('无法读取素材规模', 'error');
    }
  }
  async function confirmMemoryRefresh(): Promise<void> {
    setMemRefreshing(true);
    try {
      const st = await api.memory.refresh();
      setMemory(st);
      setMemDraft(st.content);
      setMemConfirmOpen(false);
      showToast('记忆已更新', 'success');
    } catch {
      showToast('记忆整理失败，请检查 AI 引擎配置', 'error');
    } finally {
      setMemRefreshing(false);
    }
  }
  async function saveMemory(): Promise<void> {
    setMemSaving(true);
    try {
      const st = await api.memory.update(memDraft);
      setMemory(st);
      showToast('记忆已保存', 'success');
    } catch {
      showToast('保存失败，请重试', 'error');
    } finally {
      setMemSaving(false);
    }
  }

  // ---- 定时日报 ----
  async function updateSched(next: Settings['scheduledReport'], patch: DeepPartial<Settings>): Promise<void> {
    setSettings((prev) => ({ ...prev, scheduledReport: next }));
    try {
      await api.settings.set(patch);
      const st = await api.scheduledReport.getStatus();
      setSchedStatus(st);
    } catch {
      /* ignore */
    }
  }
  async function tryRunNow(): Promise<void> {
    setSchedRunning(true);
    try {
      const st = await api.scheduledReport.runNow();
      setSchedStatus(st);
      if (st.lastResult === 'success') showToast('已生成今日日报', 'success');
      else if (st.lastResult === 'skipped') showToast('今天已有日报，已跳过', 'default');
      else showToast(st.lastMessage ? `试跑失败：${st.lastMessage}` : '试跑失败', 'error');
    } catch {
      showToast('试跑失败，请重试', 'error');
    } finally {
      setSchedRunning(false);
    }
  }

  // ---- 数据导出 / 导入 ----
  async function doExport(): Promise<void> {
    setExporting(true);
    try {
      const r = await api.dataMgmt.exportAll();
      if (r.ok) showToast(r.path ? `已导出到 ${r.path}` : '已导出备份', 'success');
      else if (r.message) showToast(r.message, 'error');
    } catch {
      showToast('导出失败，请重试', 'error');
    } finally {
      setExporting(false);
    }
  }
  async function confirmImport(): Promise<void> {
    setImporting(true);
    try {
      const r = await api.dataMgmt.importAll();
      if (r.ok) {
        setImportOpen(false);
        showToast('导入完成，正在刷新…', 'success');
        window.setTimeout(() => window.location.reload(), 700);
      } else {
        setImportOpen(false);
        if (r.message) showToast(r.message, 'error');
      }
    } catch {
      showToast('导入失败，请重试', 'error');
    } finally {
      setImporting(false);
    }
  }

  // ---- MCP ----
  function toggleMcp(enabled: boolean): void {
    commit({ ...settings, mcp: { ...settings.mcp, enabled } }, { mcp: { enabled } });
    window.setTimeout(() => {
      void api.mcp.getStatus().then(setMcpStatus).catch(() => {});
    }, 300);
  }
  function copyMcpCommand(): void {
    const cmd = `claude mcp add --transport http gleam-daily http://127.0.0.1:${settings.mcp.port}/mcp`;
    void navigator.clipboard
      .writeText(cmd)
      .then(() => showToast('已复制接入命令', 'success'))
      .catch(() => showToast('复制失败，请手动复制', 'error'));
  }
  function toggleLogs(): void {
    const next = !logsOpen;
    setLogsOpen(next);
    if (next) void api.mcp.getLogs().then(setMcpLogs).catch(() => setMcpLogs([]));
  }

  const ai = settings.ai;
  const mcpState = mcpStatus?.running ? 'running' : mcpStatus?.error ? 'error' : 'stopped';
  const mcpStatusText = mcpStatus?.running
    ? `运行中 · ${mcpStatus.url}`
    : mcpStatus?.error
      ? mcpStatus.error
      : '未启动';
  const mcpCommand = `claude mcp add --transport http gleam-daily http://127.0.0.1:${settings.mcp.port}/mcp`;

  return (
    <div className="gd-settings">
      <h1 className="gd-settings__title">设置</h1>

      {/* 1. 记录 */}
      <Card title="记录">
        <FieldRow label="启用记录" desc="在前台应用切换时静默记录你的工作轨迹。">
          <Switch checked={settings.tracking.enabled} onChange={toggleTracking} ariaLabel="启用记录" />
        </FieldRow>
        <FieldRow label="采样间隔" desc="越短越精细，也更耗电。">
          <Select
            value={String(settings.tracking.sampleIntervalSec)}
            options={SAMPLE_OPTIONS}
            onChange={(v) =>
              commit(
                { ...settings, tracking: { ...settings.tracking, sampleIntervalSec: Number(v) } },
                { tracking: { sampleIntervalSec: Number(v) } },
              )
            }
          />
        </FieldRow>
        <FieldRow label="空闲判定" desc="超过该时长无操作则视为离开，暂停记录。">
          <Select
            value={String(settings.tracking.idleThresholdSec)}
            options={IDLE_OPTIONS}
            onChange={(v) =>
              commit(
                { ...settings, tracking: { ...settings.tracking, idleThresholdSec: Number(v) } },
                { tracking: { idleThresholdSec: Number(v) } },
              )
            }
          />
        </FieldRow>
        <FieldRow label="排除应用" desc="排除的应用不记录窗口标题、不参与截图。">
          <TagInput
            values={settings.tracking.excludedApps}
            placeholder="应用名，如 1Password"
            onChange={(excludedApps) =>
              commit(
                { ...settings, tracking: { ...settings.tracking, excludedApps } },
                { tracking: { excludedApps } },
              )
            }
          />
        </FieldRow>
      </Card>

      {/* 2. 屏幕分析 */}
      <Card title="屏幕分析">
        <FieldRow label="启用屏幕分析" desc="定期截图 → 交给 AI 提炼成一句话 → 图片随即删除，不留存。">
          <Switch checked={settings.screenshots.enabled} onChange={toggleScreenshots} ariaLabel="启用屏幕分析" />
        </FieldRow>
        <FieldRow label="截图间隔" desc="每隔多久截取一次当前屏幕。">
          <Select
            value={String(settings.screenshots.intervalMin)}
            options={SHOT_INTERVAL_OPTIONS}
            onChange={(v) =>
              commit(
                { ...settings, screenshots: { ...settings.screenshots, intervalMin: Number(v) } },
                { screenshots: { intervalMin: Number(v) } },
              )
            }
          />
        </FieldRow>
        <FieldRow label="保留原始截图" desc="默认关闭。开启后原图会留在本机，可能包含隐私内容，请谨慎。" dangerDesc>
          <Switch
            checked={settings.screenshots.keepAfterAnalysis}
            ariaLabel="保留原始截图"
            onChange={(keepAfterAnalysis) =>
              commit(
                { ...settings, screenshots: { ...settings.screenshots, keepAfterAnalysis } },
                { screenshots: { keepAfterAnalysis } },
              )
            }
          />
        </FieldRow>
        {settings.screenshots.keepAfterAnalysis && (
          <FieldRow label="保留期限" desc="超过期限的原图会被自动删除（分析摘要不受影响）。按当前频率，每天约占 30-40MB。">
            <Select
              value={String(settings.screenshots.keepDays)}
              options={KEEP_DAYS_OPTIONS}
              onChange={(v) =>
                commit(
                  { ...settings, screenshots: { ...settings.screenshots, keepDays: Number(v) } },
                  { screenshots: { keepDays: Number(v) } },
                )
              }
            />
          </FieldRow>
        )}
      </Card>

      {/* 3. Git */}
      <Card title="Git 提交">
        <div className="gd-settings__block">
          <div className="gd-settings__block-label">仓库</div>
          {settings.git.repoPaths.length === 0 ? (
            <div className="gd-settings__empty-hint">还没有添加仓库。</div>
          ) : (
            settings.git.repoPaths.map((path) => (
              <div className="gd-path-row" key={path}>
                <span className="gd-path-row__path" title={path}>{path}</span>
                <Button variant="ghost" size="sm" iconOnly aria-label="移除仓库" onClick={() => removeRepo(path)}>
                  <IconTrash size={13} />
                </Button>
              </div>
            ))
          )}
        </div>
        {settings.git.scanRoots.length > 0 ? (
          <div className="gd-settings__block">
            <div className="gd-settings__block-label">扫描目录（自动发现其下的仓库）</div>
            {settings.git.scanRoots.map((path) => (
              <div className="gd-path-row" key={path}>
                <span className="gd-path-row__path" title={path}>{path}</span>
                <Button variant="ghost" size="sm" iconOnly aria-label="移除扫描目录" onClick={() => removeScanRoot(path)}>
                  <IconTrash size={13} />
                </Button>
              </div>
            ))}
          </div>
        ) : null}
        <div className="gd-settings__row-actions">
          <Button variant="secondary" size="sm" onClick={() => void addRepo()}>添加仓库</Button>
          <Button variant="secondary" size="sm" onClick={() => void addScanRoot()}>添加扫描目录</Button>
        </div>
        <FieldRow label="作者过滤" desc="只统计该作者的提交；留空则用 git 全局用户名。">
          <Input
            value={settings.git.authorFilter}
            placeholder="留空则用 git 全局用户名"
            onChange={(e) => setSettings((prev) => ({ ...prev, git: { ...prev.git, authorFilter: e.target.value } }))}
            onBlur={() => persist({ git: { authorFilter: settings.git.authorFilter } })}
            style={{ width: 220 }}
          />
        </FieldRow>
      </Card>

      {/* 4. AI 引擎 */}
      <Card title="AI 引擎">
        <div className="gd-provider-list">
          {PROVIDERS.map((p) => {
            const disabled = (p.kind === 'claude-cli' && !cliAvailable) || (p.kind === 'codex-cli' && !codexAvailable);
            const unavailableHint = disabled
              ? p.kind === 'claude-cli'
                ? '（未检测到 Claude Code，请先安装并登录）'
                : '（未检测到 Codex CLI，请先安装并登录）'
              : '';
            const selected = ai.provider === p.kind;
            return (
              <button
                type="button"
                key={p.kind}
                className="gd-provider-card gd-no-drag"
                data-selected={selected}
                data-disabled={disabled}
                disabled={disabled}
                onClick={() => selectProvider(p.kind)}
              >
                <span className="gd-provider-card__radio" data-on={selected} />
                <span className="gd-provider-card__body">
                  <span className="gd-provider-card__name">{p.name}</span>
                  <span className="gd-provider-card__desc">
                    {p.desc}
                    {unavailableHint}
                  </span>
                </span>
              </button>
            );
          })}
        </div>

        <div className="gd-provider-config">
          {ai.provider === 'claude-cli' ? (
            <FieldRow label="模型" desc="传给 Claude Code 的模型别名，如 sonnet / opus / haiku。">
              <Input
                value={ai.claudeCli.model}
                placeholder="sonnet"
                onChange={(e) => setSettings((prev) => ({ ...prev, ai: { ...prev.ai, claudeCli: { ...prev.ai.claudeCli, model: e.target.value } } }))}
                onBlur={() => persist({ ai: { claudeCli: { model: ai.claudeCli.model } } })}
                style={{ width: 190 }}
              />
            </FieldRow>
          ) : null}

          {ai.provider === 'codex-cli' ? (
            <FieldRow label="模型" desc="传给 Codex 的模型名；留空使用 Codex 默认模型。">
              <Input
                value={ai.codexCli.model}
                placeholder="留空使用 Codex 默认模型"
                onChange={(e) => setSettings((prev) => ({ ...prev, ai: { ...prev.ai, codexCli: { ...prev.ai.codexCli, model: e.target.value } } }))}
                onBlur={() => persist({ ai: { codexCli: { model: ai.codexCli.model } } })}
                style={{ width: 220 }}
              />
            </FieldRow>
          ) : null}

          {ai.provider === 'anthropic' ? (
            <>
              <FieldRow label="模型" desc="Anthropic 模型 ID。">
                <Input
                  value={ai.anthropic.model}
                  placeholder="claude-sonnet-5"
                  onChange={(e) => setSettings((prev) => ({ ...prev, ai: { ...prev.ai, anthropic: { ...prev.ai.anthropic, model: e.target.value } } }))}
                  onBlur={() => persist({ ai: { anthropic: { model: ai.anthropic.model } } })}
                  style={{ width: 220 }}
                />
              </FieldRow>
              <FieldRow label="API Key" desc="加密存储于本机，永不明文离开这台 Mac。">
                <SecretField
                  hasKey={ai.anthropic.hasKey}
                  keyMasked={ai.anthropic.keyMasked}
                  onSave={(key) => saveSecret('anthropic', key)}
                />
              </FieldRow>
            </>
          ) : null}

          {ai.provider === 'openai-compat' ? (
            <>
              <FieldRow label="Base URL" desc="兼容 OpenAI 的端点地址。">
                <Input
                  value={ai.openaiCompat.baseUrl}
                  placeholder="https://api.example.com/v1"
                  onChange={(e) => setSettings((prev) => ({ ...prev, ai: { ...prev.ai, openaiCompat: { ...prev.ai.openaiCompat, baseUrl: e.target.value } } }))}
                  onBlur={() => persist({ ai: { openaiCompat: { baseUrl: ai.openaiCompat.baseUrl } } })}
                  style={{ width: 260 }}
                />
              </FieldRow>
              <FieldRow label="模型" desc="端点支持的模型名。">
                <Input
                  value={ai.openaiCompat.model}
                  placeholder="gpt-4o-mini"
                  onChange={(e) => setSettings((prev) => ({ ...prev, ai: { ...prev.ai, openaiCompat: { ...prev.ai.openaiCompat, model: e.target.value } } }))}
                  onBlur={() => persist({ ai: { openaiCompat: { model: ai.openaiCompat.model } } })}
                  style={{ width: 220 }}
                />
              </FieldRow>
              <FieldRow label="API Key" desc="加密存储于本机。">
                <SecretField
                  hasKey={ai.openaiCompat.hasKey}
                  keyMasked={ai.openaiCompat.keyMasked}
                  onSave={(key) => saveSecret('openaiCompat', key)}
                />
              </FieldRow>
            </>
          ) : null}
        </div>

        <div className="gd-settings__block">
          <div className="gd-settings__block-label">角色描述</div>
          <Textarea
            rows={3}
            value={ai.roleContext}
            placeholder="如：后端工程师，负责订单系统…写日报时会用于把握口吻与重点"
            onChange={(e) => setSettings((prev) => ({ ...prev, ai: { ...prev.ai, roleContext: e.target.value } }))}
            onBlur={() => persist({ ai: { roleContext: ai.roleContext } })}
            style={{ width: '100%' }}
          />
        </div>

        <div className="gd-settings__test-row">
          <Button variant="secondary" size="sm" loading={test.status === 'testing'} onClick={() => void runTest()}>
            测试连接
          </Button>
          {test.status === 'ok' ? (
            <span className="gd-test-result gd-test-result--ok">
              <span className="gd-test-result__dot" />
              {test.message}
              {typeof test.latencyMs === 'number' ? ` · ${test.latencyMs}ms` : ''}
            </span>
          ) : null}
          {test.status === 'error' ? (
            <span className="gd-test-result gd-test-result--error">
              <span className="gd-test-result__dot" />
              {test.message}
            </span>
          ) : null}
        </div>
      </Card>

      {/* AI 记忆 */}
      <Card title="AI 记忆">
        <FieldRow label="启用个人记忆" desc="AI 从历史记录提炼你的项目名、技术栈、协作对象等工作画像，注入截图分析与日报，减少认错名词。">
          <Switch checked={settings.memory.enabled} onChange={toggleMemory} ariaLabel="启用个人记忆" />
        </FieldRow>
        <FieldRow label="参与截图分析" desc="识别屏幕时优先使用记忆里的标准名称。">
          <Switch checked={settings.memory.injectToVision} disabled={!settings.memory.enabled} onChange={setMemoryVision} ariaLabel="参与截图分析" />
        </FieldRow>
        <FieldRow label="参与报告生成" desc="撰写日报时优先使用记忆里的标准名称。">
          <Switch checked={settings.memory.injectToReports} disabled={!settings.memory.enabled} onChange={setMemoryReports} ariaLabel="参与报告生成" />
        </FieldRow>
        <FieldRow label="自动整理" desc="按周期在后台静默刷新记忆。">
          <SegmentControl options={AUTO_REFRESH_OPTIONS} value={settings.memory.autoRefresh} onChange={setAutoRefresh} />
        </FieldRow>
        <div className="gd-settings__block">
          <div className="gd-mem-head">
            <span className="gd-mem-stamp">上次整理：{formatStamp(memory.updatedTs)}</span>
            <div className="gd-mem-actions">
              <Button size="sm" variant="secondary" loading={memRefreshing} onClick={() => void openMemoryRefresh()}>
                立即更新记忆
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setMemEditorOpen((o) => !o)}>
                {memEditorOpen ? '收起' : '查看/编辑'}
              </Button>
            </div>
          </div>
          {memEditorOpen ? (
            <div className="gd-mem-editor">
              <Textarea
                className="gd-mem-textarea"
                rows={10}
                value={memDraft}
                placeholder="还没有记忆。点「立即更新记忆」让 AI 从近 30 天记录整理，或在此手写。"
                onChange={(e) => setMemDraft(e.target.value)}
                style={{ width: '100%' }}
              />
              <div className="gd-mem-save">
                <Button size="sm" variant="primary" loading={memSaving} onClick={() => void saveMemory()}>
                  保存记忆
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      </Card>

      {/* 定时日报 */}
      <Card title="定时日报">
        <FieldRow label="启用定时日报" desc="每天到点自动生成当日日报，并发送系统通知。">
          <Switch checked={settings.scheduledReport.enabled} onChange={(v) => void updateSched({ ...settings.scheduledReport, enabled: v }, { scheduledReport: { enabled: v } })} ariaLabel="启用定时日报" />
        </FieldRow>
        <FieldRow label="生成时间" desc="每天到这个时间自动生成。">
          <Input
            type="time"
            value={settings.scheduledReport.time}
            onChange={(e) => void updateSched({ ...settings.scheduledReport, time: e.target.value }, { scheduledReport: { time: e.target.value } })}
            style={{ width: 130 }}
          />
        </FieldRow>
        <FieldRow label="模板" desc="定时生成使用的日报模板。">
          <Select
            value={settings.scheduledReport.template}
            options={TEMPLATE_OPTIONS}
            onChange={(v) => void updateSched({ ...settings.scheduledReport, template: v }, { scheduledReport: { template: v } })}
          />
        </FieldRow>
        <div className="gd-settings__block">
          <div className="gd-settings__block-label">附加要求</div>
          <Textarea
            rows={2}
            value={settings.scheduledReport.extraInstructions}
            placeholder="例如：突出 X 项目的进展"
            onChange={(e) => setSettings((prev) => ({ ...prev, scheduledReport: { ...prev.scheduledReport, extraInstructions: e.target.value } }))}
            onBlur={() => persist({ scheduledReport: { extraInstructions: settings.scheduledReport.extraInstructions } })}
            style={{ width: '100%' }}
          />
        </div>
        <div className="gd-settings__test-row">
          <Button variant="secondary" size="sm" loading={schedRunning} onClick={() => void tryRunNow()}>
            立即试跑
          </Button>
          <span className="gd-sched-status">{schedStatusLine(schedStatus)}</span>
        </div>
      </Card>

      {/* 5. 外观与权限 */}
      <Card title="外观与权限">
        <FieldRow label="主题" desc="跟随系统，或手动固定深浅色。">
          <SegmentControl options={THEME_OPTIONS} value={settings.theme} onChange={selectTheme} />
        </FieldRow>
        <div className="gd-settings__block">
          <div className="gd-settings__block-label">系统权限</div>
          <div className="gd-perm-row">
            <span className="gd-perm-row__dot" data-state={permissions.automation} />
            <div className="gd-perm-row__text">
              <div className="gd-perm-row__label">自动化 · 记录前台应用</div>
              <div className="gd-perm-row__state">{PERMISSION_TEXT[permissions.automation]}</div>
            </div>
            <Button variant="ghost" size="sm" onClick={() => void openPerm('automation')}>
              <IconExternalLink size={13} />
              打开系统设置
            </Button>
          </div>
          <div className="gd-perm-row">
            <span className="gd-perm-row__dot" data-state={permissions.screenRecording} />
            <div className="gd-perm-row__text">
              <div className="gd-perm-row__label">屏幕录制 · 截图分析</div>
              <div className="gd-perm-row__state">{PERMISSION_TEXT[permissions.screenRecording]}</div>
            </div>
            <Button variant="ghost" size="sm" onClick={() => void openPerm('screenRecording')}>
              <IconExternalLink size={13} />
              打开系统设置
            </Button>
          </div>
        </div>
      </Card>

      {/* 6. 数据 */}
      <Card title="数据">
        <FieldRow label="数据位置" desc={dataDir ?? '所有记录与报告都存储在本机应用数据目录中。'}>
          <Button variant="ghost" size="sm" onClick={() => void revealData()}>
            <IconExternalLink size={13} />
            在 Finder 中显示
          </Button>
        </FieldRow>
        <FieldRow label="导出全部数据" desc="导出为 JSON 备份（含记录与报告，不含 AI 密钥等设置）。">
          <Button variant="secondary" size="sm" loading={exporting} onClick={() => void doExport()}>
            <IconDownload size={13} />
            导出
          </Button>
        </FieldRow>
        <FieldRow label="导入数据" desc="从 JSON 备份恢复，将覆盖现有记录（不覆盖本机设置）。">
          <Button variant="secondary" size="sm" onClick={() => setImportOpen(true)}>
            导入
          </Button>
        </FieldRow>
        <FieldRow label="清除所有数据" desc="删除全部记录、报告与截图缓存，且不可恢复。" dangerDesc>
          <Button variant="danger" size="sm" onClick={() => setClearOpen(true)}>
            清除所有数据
          </Button>
        </FieldRow>
      </Card>

      {/* Agent 接入（MCP） */}
      <Card title="Agent 接入（MCP）">
        <FieldRow label="启用 MCP 接入" desc="把本机工作数据以只读 MCP 工具暴露给本地 Agent（Claude Code / Codex）。仅监听 127.0.0.1，默认关闭。">
          <Switch checked={settings.mcp.enabled} onChange={toggleMcp} ariaLabel="启用 MCP 接入" />
        </FieldRow>
        <FieldRow label="端口" desc="MCP HTTP 服务监听端口。">
          <Input
            type="number"
            value={String(settings.mcp.port)}
            onChange={(e) => setSettings((prev) => ({ ...prev, mcp: { ...prev.mcp, port: Number(e.target.value) || 0 } }))}
            onBlur={() => persist({ mcp: { port: settings.mcp.port } })}
            style={{ width: 120 }}
          />
        </FieldRow>
        <div className="gd-settings__block">
          <div className="gd-settings__block-label">运行状态</div>
          <div className="gd-mcp-status">
            <span className="gd-mcp-status__dot" data-state={mcpState} />
            <span className="gd-mcp-status__text">{mcpStatusText}</span>
          </div>
        </div>
        <div className="gd-settings__block">
          <div className="gd-settings__block-label">接入命令</div>
          <div className="gd-code-block">
            <code className="gd-mono">{mcpCommand}</code>
            <Button variant="ghost" size="sm" iconOnly aria-label="复制接入命令" onClick={copyMcpCommand}>
              <IconCopy size={13} />
            </Button>
          </div>
          <div className="gd-settings__empty-hint">在终端执行即可把拾光日报接入 Claude Code。</div>
        </div>
        <div className="gd-settings__block">
          <button type="button" className="gd-mcp-logs-toggle gd-no-drag" onClick={toggleLogs}>
            <IconChevronDown size={14} style={{ transform: logsOpen ? 'rotate(180deg)' : undefined }} />
            请求日志
            <span className="gd-mcp-logs-hint">（最近 50 条）</span>
          </button>
          {logsOpen ? (
            mcpLogs.length === 0 ? (
              <div className="gd-settings__empty-hint">暂无请求</div>
            ) : (
              <div className="gd-mcp-logs">
                <div className="gd-mcp-logs__head">
                  <span style={{ width: 60 }}>时间</span>
                  <span style={{ flex: 1 }}>工具</span>
                  <span style={{ width: 64, textAlign: 'right' }}>耗时</span>
                  <span style={{ width: 44, textAlign: 'right' }}>结果</span>
                </div>
                {mcpLogs.slice(0, 50).map((log, i) => (
                  <div className="gd-mcp-logs__row" key={`${log.ts}-${i}`}>
                    <span className="gd-mono" style={{ width: 60 }}>
                      {formatClockTime(log.ts)}
                    </span>
                    <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{log.tool}</span>
                    <span className="gd-mono" style={{ width: 64, textAlign: 'right' }}>
                      {log.durationMs}ms
                    </span>
                    <span style={{ width: 44, textAlign: 'right', color: log.ok ? 'var(--ok)' : 'var(--danger)' }}>{log.ok ? '成功' : '失败'}</span>
                  </div>
                ))}
              </div>
            )
          ) : null}
        </div>
      </Card>

      <div className="gd-settings__footer">
        {version ? `v${version} · ` : ''}拾光日报 · 本地优先，你的数据不离开这台 Mac
      </div>

      <Modal
        open={clearOpen}
        title="清除所有数据？"
        body="这会删除全部工作记录、生成的报告与截图缓存，操作不可撤销。"
        confirmLabel="清除"
        danger
        confirmLoading={clearing}
        onConfirm={() => void confirmClear()}
        onCancel={() => setClearOpen(false)}
      />

      <Modal
        open={memConfirmOpen}
        title="更新个人记忆？"
        body={
          memPreview
            ? `将读取近 30 天素材（${memPreview.sessionCount} 段活动 · ${memPreview.screenshotCount} 条截图摘要 · ${memPreview.noteCount} 条速记 · ${memPreview.commitCount} 次提交，约 ${memPreview.charCount} 字），交给当前 AI 引擎整理成个人工作画像，并覆盖现有记忆。`
            : '将读取近 30 天素材整理成个人工作画像，并覆盖现有记忆。'
        }
        confirmLabel="开始整理"
        confirmLoading={memRefreshing}
        onConfirm={() => void confirmMemoryRefresh()}
        onCancel={() => setMemConfirmOpen(false)}
      />

      <Modal
        open={importOpen}
        title="导入数据？"
        body="导入会先清空当前所有记录、报告与截图分析，再写入备份数据。此操作不可撤销，且不会覆盖本机的 AI 与密钥设置。"
        confirmLabel="导入并覆盖"
        danger
        confirmLoading={importing}
        onConfirm={() => void confirmImport()}
        onCancel={() => setImportOpen(false)}
      />
    </div>
  );
}
