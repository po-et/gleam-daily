// 今日页（DESIGN §3 / §10）：头部动作（识别当前屏幕 / 补录）+ 时间线（可编辑、含手动记录）+ 三统计卡 + 分类分布/速记双栏 + 生成 CTA。
import { useEffect, useRef, useState, type JSX } from 'react';
import type { DayStats, ManualRecord, Session, TrackerStatus } from '@shared/types';
import { api } from '../api';
import { dayRangeMs, formatDateHeading, formatDuration, todayDateString, truncate } from '../lib/format';
import { useInterval } from '../lib/hooks';
import { goToReportsAutoGenerate } from '../lib/navigate';
import Timeline from './today/Timeline';
import BackfillModal from './today/BackfillModal';
import StatsCards from './today/StatsCards';
import CategoryBreakdown from '../components/CategoryBreakdown';
import NotesPanel from '../components/NotesPanel';
import Button from '../components/Button';
import { useToast } from '../components/Toast';
import { IconCamera, IconChevronDown, IconPlus, IconSpinner } from '../components/icons';
import './Today.css';

const EMPTY_STATS: DayStats = {
  date: todayDateString(),
  totalActiveMs: 0,
  byCategory: {},
  topApps: [],
  contextSwitches: 0,
  focusBlocks: [],
};

function BackfillMenu({
  onManual,
  onClipboard,
  onFile,
}: {
  onManual: () => void;
  onClipboard: () => void;
  onFile: () => void;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open]);

  return (
    <div className="gd-backfill" ref={ref}>
      <Button variant="secondary" size="sm" onClick={onManual}>
        <IconPlus size={14} />
        补录
      </Button>
      <Button variant="secondary" size="sm" iconOnly aria-label="更多补录方式" onClick={() => setOpen((o) => !o)}>
        <IconChevronDown size={14} />
      </Button>
      {open ? (
        <div className="gd-backfill__menu">
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onClipboard();
            }}
          >
            从剪贴板识别
          </button>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onFile();
            }}
          >
            选择图片识别
          </button>
        </div>
      ) : null}
    </div>
  );
}

export default function Today(): JSX.Element {
  const { showToast } = useToast();
  const date = todayDateString();
  const { startTs, endTs } = dayRangeMs(date);
  const [stats, setStats] = useState<DayStats>(EMPTY_STATS);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [manualRecords, setManualRecords] = useState<ManualRecord[]>([]);
  const [notesCount, setNotesCount] = useState(0);
  const [trackerStatus, setTrackerStatus] = useState<TrackerStatus | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [backfillOpen, setBackfillOpen] = useState(false);
  const [editRecord, setEditRecord] = useState<ManualRecord | null>(null);

  async function load(): Promise<void> {
    try {
      const [nextStats, nextSessions, nextManual] = await Promise.all([
        api.data.getDayStats(date),
        api.data.getSessions(startTs, endTs),
        api.data.listManualRecords(startTs, endTs),
      ]);
      setStats(nextStats);
      setSessions(nextSessions);
      setManualRecords(nextManual);
    } catch {
      // 主进程功能桩未就绪：保持空态，绝不白屏。
      setStats(EMPTY_STATS);
      setSessions([]);
      setManualRecords([]);
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

  async function analyzeNow(): Promise<void> {
    if (analyzing) return;
    setAnalyzing(true);
    try {
      const res = await api.capture.analyzeNow();
      if (res.ok) {
        const summary = res.analysis.summary?.trim();
        showToast(summary ? `已记录：${truncate(summary, 30)}` : '已记录当前屏幕', 'success');
        await load();
      } else {
        showToast(res.reason || '识别失败，请重试', 'error');
      }
    } catch {
      showToast('识别失败，请重试', 'error');
    } finally {
      setAnalyzing(false);
    }
  }

  async function importImage(source: 'clipboard' | 'file'): Promise<void> {
    if (importing) return;
    setImporting(true);
    try {
      const res = await api.data.importImage(source);
      if (res.ok) {
        showToast('已记录到时间线', 'success');
        await load();
      } else if (res.reason === 'sensitive') {
        showToast(res.message || '画面含敏感内容，已跳过', 'error');
      } else if (res.reason === 'cancelled') {
        // 用户取消，保持安静
      } else if (res.reason === 'empty-clipboard') {
        showToast(res.message || '剪贴板里没有图片', 'default');
      } else {
        showToast(res.message || '识别失败，请重试', 'error');
      }
    } catch {
      showToast('识别失败，请重试', 'error');
    } finally {
      setImporting(false);
    }
  }

  function openCreate(): void {
    setEditRecord(null);
    setBackfillOpen(true);
  }

  function openEdit(record: ManualRecord): void {
    setEditRecord(record);
    setBackfillOpen(true);
  }

  return (
    <div className="gd-today">
      <div className="gd-today__header">
        <h1 className="gd-today__title">{formatDateHeading(date)}</h1>
        <div className="gd-today__header-right">
          <div className="gd-today__subline gd-mono">
            已专注 {formatDuration(stats.totalActiveMs)} · 切换 {stats.contextSwitches} 次
          </div>
          <div className="gd-today__actions">
            <Button variant="secondary" size="sm" loading={analyzing} onClick={() => void analyzeNow()}>
              {analyzing ? null : <IconCamera size={14} />}
              {analyzing ? '识别中…' : '识别当前屏幕'}
            </Button>
            <BackfillMenu onManual={openCreate} onClipboard={() => void importImage('clipboard')} onFile={() => void importImage('file')} />
          </div>
        </div>
      </div>

      <Timeline
        date={date}
        sessions={sessions}
        manualRecords={manualRecords}
        permissionDenied={permissionDenied}
        onChanged={() => void load()}
        onEditRecord={openEdit}
      />

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

      <BackfillModal open={backfillOpen} initial={editRecord} onClose={() => setBackfillOpen(false)} onSubmitted={() => void load()} />

      {importing ? (
        <div className="gd-modal-overlay gd-no-drag">
          <div className="gd-loading-modal">
            <IconSpinner size={22} />
            <div className="gd-loading-modal__text">AI 识别中…约 10 秒</div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
