// 侧栏（DESIGN §2）：宽 216，导航 + 底部记录状态胶囊。
import { useEffect, useState, type JSX } from 'react';
import type { TrackerStatus } from '@shared/types';
import { api } from '../api';
import { formatDuration, todayDateString } from '../lib/format';
import { useInterval } from '../lib/hooks';
import { IconLayers, IconPaper, IconSlider, IconSun } from './icons';
import './Sidebar.css';

export type PageKey = 'today' | 'reports' | 'materials' | 'settings';

const NAV_ITEMS: { key: PageKey; label: string; Icon: (props: { size?: number }) => JSX.Element }[] = [
  { key: 'today', label: '今日', Icon: IconSun },
  { key: 'reports', label: '报告', Icon: IconPaper },
  { key: 'materials', label: '素材', Icon: IconLayers },
  { key: 'settings', label: '设置', Icon: IconSlider },
];

export default function Sidebar({ current }: { current: PageKey }): JSX.Element {
  const [status, setStatus] = useState<TrackerStatus | null>(null);
  const [activeMs, setActiveMs] = useState(0);

  async function refreshActiveMs(): Promise<void> {
    try {
      const stats = await api.data.getDayStats(todayDateString());
      setActiveMs(stats.totalActiveMs);
    } catch {
      // 桩数据/尚未就绪：保持上一次的值，不让侧栏抛错。
    }
  }

  useEffect(() => {
    let disposed = false;
    void (async () => {
      try {
        const s = await api.tracker.getStatus();
        if (!disposed) setStatus(s);
      } catch {
        // ignore
      }
    })();
    void refreshActiveMs();
    const unsubscribe = api.tracker.onStatus((s) => setStatus(s));
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, []);

  useInterval(() => void refreshActiveMs(), 30000);

  async function toggleEnabled(): Promise<void> {
    if (!status) return;
    try {
      await api.tracker.setEnabled(!status.enabled);
    } catch {
      // ignore：main 尚未实现时不阻塞 UI
    }
  }

  const enabled = status?.enabled ?? false;

  return (
    <aside className="gd-sidebar">
      <div className="gd-sidebar__brand">
        <span className="gd-sidebar__logo" />
        <span className="gd-sidebar__brand-text">拾光日报</span>
      </div>
      <nav className="gd-sidebar__nav">
        {NAV_ITEMS.map(({ key, label, Icon }) => (
          <a key={key} href={`#/${key}`} className="gd-sidebar__item gd-no-drag" data-active={current === key}>
            <Icon size={16} />
            {label}
          </a>
        ))}
      </nav>
      <div className="gd-sidebar__spacer" />
      <button type="button" className="gd-sidebar__status gd-no-drag" onClick={() => void toggleEnabled()} title={enabled ? '点击暂停记录' : '点击恢复记录'}>
        <span className="gd-sidebar__status-dot" data-on={enabled} />
        <span className="gd-sidebar__status-text">{enabled ? `记录中 · ${formatDuration(activeMs)}` : '已暂停'}</span>
      </button>
    </aside>
  );
}
