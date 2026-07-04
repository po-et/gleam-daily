// 菜单栏托盘。见 docs/SPEC.md §12。
import { join } from 'node:path';
import { Menu, Notification, Tray, app, nativeImage } from 'electron';
import { getSessions } from './db';
import { computeDayStats } from './dayStats';
import { generateReport } from './reports/generator';
import { analyzeNow } from './screenshots';
import { getSettings, setSettings } from './settings';
import { setTrackingEnabled } from './tracker';
import { createQuickNoteWindow, getMainWindow, navigateMainWindow, setQuitting, showMainWindow } from './windows';

let tray: Tray | null = null;
let refreshTimer: ReturnType<typeof setInterval> | null = null;

/** 正式模板图标（scripts/make-icons.sh 产出）优先；找不到时回退到程序化生成的占位圆点，保证任何环境下都不会崩溃。 */
function loadTemplateIcon(): Electron.NativeImage {
  const resourcesDir = app.isPackaged ? process.resourcesPath : join(__dirname, '../../resources');
  const candidates = [join(resourcesDir, 'trayTemplate@2x.png'), join(resourcesDir, 'trayTemplate.png')];
  for (const candidate of candidates) {
    const image = nativeImage.createFromPath(candidate);
    if (!image.isEmpty()) {
      image.setTemplateImage(true);
      return image;
    }
  }
  return createPlaceholderTemplateIcon();
}

function createPlaceholderTemplateIcon(): Electron.NativeImage {
  const size = 18;
  const buffer = Buffer.alloc(size * size * 4); // BGRA，Electron nativeImage 原始缓冲区约定
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 3;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      const dx = x - cx + 0.5;
      const dy = y - cy + 0.5;
      const inside = dx * dx + dy * dy <= r * r;
      buffer[idx] = 0; // B
      buffer[idx + 1] = 0; // G
      buffer[idx + 2] = 0; // R
      buffer[idx + 3] = inside ? 255 : 0; // A
    }
  }
  const image = nativeImage.createFromBuffer(buffer, { width: size, height: size });
  image.setTemplateImage(true);
  return image;
}

function formatDuration(ms: number): string {
  const totalMinutes = Math.floor(ms / 60_000);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${h}h${m}m`;
}

function todayDateStr(): string {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function todayActiveDuration(): string {
  const dateStr = todayDateStr();
  const dayStart = new Date(`${dateStr}T00:00:00`).getTime();
  const dayEnd = dayStart + 24 * 60 * 60 * 1000;
  const stats = computeDayStats(dateStr, getSessions(dayStart, dayEnd));
  return formatDuration(stats.totalActiveMs);
}

/**
 * 打开主窗并跳转到报告页、自动触发今日日报生成。
 * preload 当前没有暴露任何“导航到某页”的白名单 API（那是渲染层的路由细节，属于契约冻结范围，
 * 本次任务不允许改 preload/renderer），所以这里用两条腿走路：
 *   1) 尽力而为：往渲染层发一个 `app:navigate` 事件 + 直接把 window.location.hash 改到 #/reports——
 *      前者需要 renderer 自行加一个 ipcRenderer 监听才能生效（当前不会生效，留给集成阶段）；
 *      后者是对 App.tsx 已有的纯 hash 路由约定的只读利用，不涉及改动 preload/renderer 代码，
 *      在当前渲染层实现下就能真正把主窗口切到“报告”页。
 *   2) 保证效果：直接在主进程内调用 generateReport(...)，进度经既有的 `reports:progress` 事件
 *      广播（preload 已经暴露 onProgress），报告页只要挂载后监听了 onProgress 就能看到生成过程；
 *      即便用户此刻还没切到报告页，生成完成后报告也已经落库，之后打开报告页历史列表里就能看到。
 */
function openMainWindowAndGenerateTodayReport(): void {
  // 可靠地把主窗切到报告页（冷启动也会等页面加载完成再切 hash）。故意用纯 '#/reports'（不带 autoGenerate 查询参数）：
  // 生成动作由主进程直接发起（下方 generateReport），保证一定会生成；渲染层只负责展示，不再重复触发，
  // 从而规避“主进程 + 渲染层各触发一次 -> 并发保护拒绝第二次并弹出错误提示”的双触发问题。
  navigateMainWindow('#/reports');

  // 未来若 preload 扩展出 app.onNavigate 事件，这条广播即可被渲染层接收；当前渲染层未监听该 IPC 通道，为无害空转。
  const win = getMainWindow();
  if (win && !win.isDestroyed()) {
    const sendNavigate = (): void => {
      if (!win.isDestroyed()) win.webContents.send('app:navigate', { page: 'reports', autoGenerate: true });
    };
    if (win.webContents.isLoading()) win.webContents.once('did-finish-load', sendNavigate);
    else sendNavigate();
  }

  const settings = getSettings();
  void generateReport({ type: 'daily', date: todayDateStr(), template: settings.report.defaultTemplate });
}

/** 托盘「识别当前屏幕」：走完整截图→分析→删图流水线，完成后发系统通知展示一句话摘要（SPEC §17.F、DESIGN §12）。 */
async function captureCurrentScreenAndNotify(): Promise<void> {
  const result = await analyzeNow();
  if (!Notification.isSupported()) return;
  if (result.ok) {
    new Notification({ title: '已识别当前屏幕', body: result.analysis.summary || '（未识别到有效内容）' }).show();
  } else {
    new Notification({ title: '识别当前屏幕失败', body: result.reason }).show();
  }
}

function buildMenu(): Menu {
  const settings = getSettings();
  return Menu.buildFromTemplate([
    { label: `今日已记录 ${todayActiveDuration()}`, enabled: false },
    { type: 'separator' },
    {
      label: settings.tracking.enabled ? '暂停记录' : '恢复记录',
      click: () => {
        const nextEnabled = !settings.tracking.enabled;
        setSettings({ tracking: { enabled: nextEnabled } });
        setTrackingEnabled(nextEnabled);
        refreshTrayMenu();
      },
    },
    {
      label: '快速速记  ⌥⌘N',
      click: () => createQuickNoteWindow(),
    },
    {
      label: '生成今日日报',
      click: () => openMainWindowAndGenerateTodayReport(),
    },
    {
      label: '识别当前屏幕',
      click: () => {
        void captureCurrentScreenAndNotify();
      },
    },
    { type: 'separator' },
    { label: '打开拾光日报', click: () => showMainWindow() },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        setQuitting(true);
        app.quit();
      },
    },
  ]);
}

export function refreshTrayMenu(): void {
  if (!tray || tray.isDestroyed()) return;
  tray.setContextMenu(buildMenu());
}

export function createTray(): Tray {
  if (tray && !tray.isDestroyed()) return tray;

  tray = new Tray(loadTemplateIcon());
  tray.setToolTip('拾光日报');
  tray.setContextMenu(buildMenu());
  // “今日已记录”这一行是禁用态展示项，需要在菜单每次弹出前刷新一次，而不是只靠 60s 轮询。
  tray.on('click', () => {
    refreshTrayMenu();
    tray?.popUpContextMenu();
  });

  refreshTimer = setInterval(refreshTrayMenu, 60_000);

  return tray;
}

export function destroyTray(): void {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
  if (tray && !tray.isDestroyed()) {
    tray.destroy();
  }
  tray = null;
}
