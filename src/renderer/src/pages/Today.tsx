// 今日页（DESIGN §3）：时间线 + 三统计卡 + 分类分布/速记双栏 + 生成 CTA。
import { useEffect, useState, type JSX } from 'react';
import type { DayStats, Session, TrackerStatus } from '@shared/types';
import { api } from '../api';
import { dayRangeMs, formatDateHeading, formatDuration, todayDateString } from '../lib/format';
import { useInterval } from '../lib/hooks';
import { goToReportsAutoGenerate } from '../lib/navigate';
import Timeline from './today/Timeline';
import StatsCards from './today/StatsCards';
import CategoryBreakdown from '../components/CategoryBreakdown';
import NotesPanel from '../components/NotesPanel';
import Button from '../components/Button';
import './Today.css';

const EMPTY_STATS: DayStats = {
  date: todayDateString(),
  totalActiveMs: 0,
  byCategory: {},
  topApps: [],
  contextSwitches: 0,
  focusBlocks: [],
};

export default function Today(): JSX.Element {
  const date = todayDateString();
  const { startTs, endTs } = dayRangeMs(date);
  const [stats, setStats] = useState<DayStats>(EMPTY_STATS);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [notesCount, setNotesCount] = useState(0);
  const [trackerStatus, setTrackerStatus] = useState<TrackerStatus | null>(null);

  async function load(): Promise<void> {
    try {
      const [nextStats, nextSessions] = await Promise.all([api.data.getDayStats(date), api.data.getSessions(startTs, endTs)]);
      setStats(nextStats);
      setSessions(nextSessions);
    } catch {
      // 主进程功能桩未就绪：保持空态，绝不白屏。
      setStats(EMPTY_STATS);
      setSessions([]);
    }
  }

  useEffect(() => {
    void load();
    let disposed = false;
    void (async () => {
      try {
        const s = await api.tracker.getStatus();
        if (!disposed) setTrackerStatus(s);
      } catch {
        // ignore
      }
    })();
    const unsubscribe = api.tracker.onStatus((s) => setTrackerStatus(s));
    return () => {
      disposed = true;
      unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useInterval(() => void load(), 30000);

  const permissionDenied = trackerStatus?.permissions.automation === 'denied';

  return (
    <div className="gd-today">
      <div className="gd-today__header">
        <h1 className="gd-today__title">{formatDateHeading(date)}</h1>
        <div className="gd-today__subline gd-mono">
          已专注 {formatDuration(stats.totalActiveMs)} · 切换 {stats.contextSwitches} 次
        </div>
      </div>

      <Timeline date={date} sessions={sessions} permissionDenied={permissionDenied} />

      <StatsCards stats={stats} />

      <div className="gd-today__cols">
        <CategoryBreakdown byCategory={stats.byCategory} />
        <NotesPanel startTs={startTs} endTs={endTs} title="今日速记" onNotesChange={(notes) => setNotesCount(notes.length)} />
      </div>

      <div className="gd-today__cta">
        <span className="gd-today__cta-text">今天的故事已经记下 {notesCount} 条，让 AI 帮你写成日报</span>
        <Button variant="primary" onClick={() => goToReportsAutoGenerate(date)}>
          生成今日日报
        </Button>
      </div>
    </div>
  );
}
