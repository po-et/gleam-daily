// app 入口：单实例锁、窗口/托盘装配、IPC 注册。
import { app, globalShortcut } from 'electron';
import { registerIpcHandlers } from './ipc';
import { initScreenshotsCleanup, setScreenshotsEnabled, stopScreenshots } from './screenshots';
import { getSettings } from './settings';
import { createTray, destroyTray, refreshTrayMenu } from './tray';
import { setTrackingEnabled, stopTracker } from './tracker';
import { createMainWindow, createQuickNoteWindow, setQuitting, showMainWindow } from './windows';

// 显式固定 app name，进而固定 userData 目录为 ~/Library/Application Support/gleam-daily，
// 与 src/main/paths.ts 在非 Electron 环境下的回退路径保持一致（供 seed 脚本等复用）。
app.setName('gleam-daily');

// 仅供本地调试/自动化验收：GLEAM_REMOTE_DEBUG=<port> 时开启 CDP 端口。默认关闭，不影响正常使用。
if (process.env.GLEAM_REMOTE_DEBUG) {
  app.commandLine.appendSwitch('remote-debugging-port', process.env.GLEAM_REMOTE_DEBUG);
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    showMainWindow();
  });

  app.whenReady().then(() => {
    registerIpcHandlers();
    createMainWindow();
    createTray();

    // 「静默记录」是产品定位：根据持久化设置决定是否自动开始采样/截图，不需要用户每次手动开启。
    const settings = getSettings();
    setTrackingEnabled(settings.tracking.enabled);
    setScreenshotsEnabled(settings.screenshots.enabled);
    // 24h 失败/悬挂截图清理与「截图功能当前是否开启」无关，无条件启动一次。
    initScreenshotsCleanup();

    const registered = globalShortcut.register('Alt+Command+N', () => {
      createQuickNoteWindow();
    });
    if (!registered) {
      console.warn('[main] 全局快捷键 ⌥⌘N 注册失败（可能与其他 App 冲突）。');
    }

    app.on('activate', () => {
      showMainWindow();
    });
  });

  app.on('window-all-closed', () => {
    // 常驻托盘：不退出。主窗口 close 事件已经把「关闭」变成「隐藏」，
    // 这里只是双保险 —— 理论上不会真的走到“全部窗口已关闭”这一步。
  });

  app.on('before-quit', () => {
    setQuitting(true);
  });

  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
    destroyTray();
    stopTracker();
    stopScreenshots();
  });

  // 托盘上的“今日已记录”文案需要随时间推进而更新；每次窗口重新可见时也顺手刷新一次。
  app.on('browser-window-focus', () => {
    refreshTrayMenu();
  });
}
