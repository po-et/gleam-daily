// hash 路由：#/quick-note 走速记小窗内容；其余（今日/报告/素材/设置）走主界面 + 侧栏。
import { useEffect, useState, type JSX } from 'react';
import Sidebar, { type PageKey } from './components/Sidebar';
import { ToastProvider } from './components/Toast';
import Today from './pages/Today';
import Reports from './pages/Reports';
import Stats from './pages/Stats';
import Materials from './pages/Materials';
import SettingsPage from './pages/Settings';
import QuickNote from './pages/QuickNote';
import { api } from './api';
import { applyTheme, watchSystemTheme } from './lib/theme';
import './global.css';

function useHash(): string {
  const [hash, setHash] = useState(window.location.hash);
  useEffect(() => {
    const onChange = (): void => setHash(window.location.hash);
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return hash;
}

/** settings.theme + matchMedia 双源 -> html[data-theme]（DESIGN §1）。
 *  初始读取用户偏好并应用；同时订阅系统深浅色变化，'system' 模式下自动跟随。
 *  设置页切换主题时直接调用 applyTheme() 即时生效（无需重新挂载本 hook）。 */
function useThemeSync(): void {
  useEffect(() => {
    let disposed = false;
    const unwatch = watchSystemTheme();
    void (async () => {
      try {
        const settings = await api.settings.get();
        if (disposed) return;
        applyTheme(settings.theme);
      } catch {
        // preload 尚未就绪或 IPC 异常：保持系统默认主题（applyTheme('system') 兜底），不阻塞渲染。
        if (!disposed) applyTheme('system');
      }
    })();
    return () => {
      disposed = true;
      unwatch();
    };
  }, []);
}

const PAGES: Record<PageKey, () => JSX.Element> = {
  today: Today,
  reports: Reports,
  stats: Stats,
  materials: Materials,
  settings: SettingsPage,
};

function resolvePageKey(hash: string): PageKey {
  const path = hash.split('?')[0] ?? '';
  const match = (Object.keys(PAGES) as PageKey[]).find((key) => path === `#/${key}`);
  return match ?? 'today';
}

export default function App(): JSX.Element {
  const hash = useHash();
  useThemeSync();

  if (hash.startsWith('#/quick-note')) {
    // 速记小窗是独立无边框窗口，不套用主界面外壳/拖拽区/Toast（自身已在 QuickNote 内处理反馈）。
    return <QuickNote />;
  }

  const pageKey = resolvePageKey(hash);
  const Page = PAGES[pageKey];

  return (
    <ToastProvider>
      <div className="gd-app-shell">
        <div className="gd-drag-region" />
        <Sidebar current={pageKey} />
        <main className="gd-app-main" key={pageKey}>
          <Page />
        </main>
      </div>
    </ToastProvider>
  );
}
