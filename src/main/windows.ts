// 主窗口 + 速记小窗管理。
import { join } from 'node:path';
import { BrowserWindow, app, screen } from 'electron';

const PRELOAD_PATH = join(__dirname, '../preload/index.js');
const RENDERER_HTML = join(__dirname, '../renderer/index.html');

function isDev(): boolean {
  return !app.isPackaged;
}

function loadRoute(win: BrowserWindow, hash?: string): void {
  const devUrl = process.env['ELECTRON_RENDERER_URL'];
  if (isDev() && devUrl) {
    void win.loadURL(hash ? `${devUrl}#${hash}` : devUrl);
  } else {
    void win.loadFile(RENDERER_HTML, hash ? { hash } : undefined);
  }
}

let mainWindow: BrowserWindow | null = null;
let quickNoteWindow: BrowserWindow | null = null;

/** 真正退出应用前（Tray「退出」菜单 / Cmd+Q）需要把这个置 true，否则主窗口 close 只会被隐藏。 */
let quitting = false;

export function setQuitting(value: boolean): void {
  quitting = value;
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}

export function createMainWindow(): BrowserWindow {
  if (mainWindow && !mainWindow.isDestroyed()) {
    return mainWindow;
  }

  const win = new BrowserWindow({
    width: 1080,
    height: 720,
    minWidth: 900,
    minHeight: 600,
    show: false,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    backgroundColor: '#FAF9F5',
    webPreferences: {
      preload: PRELOAD_PATH,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  win.once('ready-to-show', () => win.show());

  // 关闭主窗口 = 隐藏（应用常驻托盘，Dock 图标点击可恢复）。
  win.on('close', (event) => {
    if (quitting) return;
    event.preventDefault();
    win.hide();
  });

  win.on('closed', () => {
    mainWindow = null;
  });

  loadRoute(win);
  mainWindow = win;
  return win;
}

export function showMainWindow(): void {
  const win = mainWindow && !mainWindow.isDestroyed() ? mainWindow : createMainWindow();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

/**
 * 把主窗口显示出来并导航到指定 hash 路由（如 '#/reports'）。
 * 冷启动时窗口的渲染层尚未加载完成，直接改 hash 会丢失；此时挂到 did-finish-load 再切，保证可靠。
 * 只操作纯 hash 路径（不带查询参数），是对渲染层既有 hash 路由约定的只读利用，不触碰 preload/renderer 契约。
 */
export function navigateMainWindow(hash: string): void {
  showMainWindow();
  const win = mainWindow;
  if (!win || win.isDestroyed()) return;
  const apply = (): void => {
    if (win.isDestroyed()) return;
    void win.webContents.executeJavaScript(`window.location.hash = ${JSON.stringify(hash)};`, true).catch(() => {
      // 渲染层可能在极端时序下仍未就绪，忽略；主进程侧的动作（如报告生成）不依赖这次导航。
    });
  };
  if (win.webContents.isLoading()) {
    win.webContents.once('did-finish-load', apply);
  } else {
    apply();
  }
}

export function getQuickNoteWindow(): BrowserWindow | null {
  return quickNoteWindow;
}

const QUICK_NOTE_WIDTH = 360;
const QUICK_NOTE_HEIGHT = 160;

export function createQuickNoteWindow(): BrowserWindow {
  if (quickNoteWindow && !quickNoteWindow.isDestroyed()) {
    quickNoteWindow.show();
    quickNoteWindow.focus();
    return quickNoteWindow;
  }

  const win = new BrowserWindow({
    width: QUICK_NOTE_WIDTH,
    height: QUICK_NOTE_HEIGHT,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: PRELOAD_PATH,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  win.once('ready-to-show', () => {
    centerWindowUpperThird(win);
    // 全局快捷键触发时，此刻拥有键盘焦点的通常是另一个 App；显式 steal focus 到本 App，
    // 否则这个无边框置顶窗口虽然可见，但 textarea 的 autoFocus 可能收不到真实键盘输入。
    app.focus({ steal: true });
    win.show();
    win.focus();
  });

  win.on('blur', () => {
    if (!win.isDestroyed()) win.hide();
  });

  win.on('closed', () => {
    quickNoteWindow = null;
  });

  loadRoute(win, '/quick-note');
  quickNoteWindow = win;
  return win;
}

function centerWindowUpperThird(win: BrowserWindow): void {
  const display = screen.getPrimaryDisplay();
  const { width: screenWidth, height: screenHeight } = display.workAreaSize;
  const winWidth = win.getSize()[0] ?? QUICK_NOTE_WIDTH;
  const x = Math.round((screenWidth - winWidth) / 2) + display.workArea.x;
  const y = Math.round(screenHeight / 3) + display.workArea.y;
  win.setPosition(x, y);
}

export function hideQuickNoteWindow(): void {
  if (quickNoteWindow && !quickNoteWindow.isDestroyed()) {
    quickNoteWindow.hide();
  }
}
