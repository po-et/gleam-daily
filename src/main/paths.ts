// 路径解析工具。刻意与 Electron app 对象解耦：既能在 main 进程内运行（拿到真实 userData 路径），
// 也能在纯 Node 环境（seed 脚本等）下运行 —— 此时回退到与 Electron 在 mac 上实际使用的
// `~/Library/Application Support/<app name>` 规则保持一致的路径（前提：main/index.ts 已 app.setName('gleam-daily')）。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const APP_NAME = 'gleam-daily';

/** 尝试拿到正在运行的 Electron app 实例；非 Electron 主进程环境下返回 null，不抛异常。 */
function tryGetElectronApp(): { getPath: (name: 'userData') => string } | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const electron = require('electron') as unknown;
    if (electron && typeof electron === 'object' && 'app' in electron) {
      const app = (electron as { app?: { getPath?: (name: string) => string; isReady?: () => boolean } }).app;
      if (app && typeof app.getPath === 'function') {
        return app as { getPath: (name: 'userData') => string };
      }
    }
    return null;
  } catch {
    return null;
  }
}

/** userData 根目录。main 进程内 = app.getPath('userData')；否则回退到 mac 默认规则。 */
export function resolveUserDataDir(): string {
  const app = tryGetElectronApp();
  if (app) {
    try {
      const p = app.getPath('userData');
      if (p) return p;
    } catch {
      // app 尚未 ready 或其他异常，走回退路径
    }
  }
  return path.join(os.homedir(), 'Library', 'Application Support', APP_NAME);
}

export function resolveDbPath(): string {
  const dir = resolveUserDataDir();
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, 'gleam.db');
}

export function resolveSettingsPath(): string {
  const dir = resolveUserDataDir();
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, 'settings.json');
}

export function resolveScreenshotsDir(): string {
  const dir = path.join(resolveUserDataDir(), 'screenshots');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export const APP_DISPLAY_NAME = APP_NAME;
