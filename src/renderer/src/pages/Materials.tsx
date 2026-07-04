// 素材页（DESIGN §5）：日期导航 + 四 tab（活动/屏幕分析/提交/速记）。
import { useEffect, useState, type JSX } from 'react';
import type { GitCommit, ManualRecord, ScreenshotAnalysis, Session, Settings } from '@shared/types';
import { api } from '../api';
import { dayRangeMs, formatDateHeading, shiftDateString, todayDateString } from '../lib/format';
import Button from '../components/Button';
import SegmentControl from '../components/SegmentControl';
import { Input } from '../components/FormControls';
import NotesPanel from '../components/NotesPanel';
import { IconChevronLeft, IconChevronRight } from '../components/icons';
import ActivityTab from './materials/ActivityTab';
import ScreenshotsTab from './materials/ScreenshotsTab';
import CommitsTab from './materials/CommitsTab';
import './Materials.css';

type MaterialsTab = 'activity' | 'screenshots' | 'commits' | 'notes';

const TAB_OPTIONS: { value: MaterialsTab; label: string }[] = [
  { value: 'activity', label: '活动' },
  { value: 'screenshots', label: '屏幕分析' },
  { value: 'commits', label: '提交' },
  { value: 'notes', label: '速记' },
];

export default function Materials(): JSX.Element {
  const [date, setDate] = useState(todayDateString());
  const [tab, setTab] = useState<MaterialsTab>('activity');
  const [sessions, setSessions] = useState<Session[]>([]);
  const [manualRecords, setManualRecords] = useState<ManualRecord[]>([]);
  const [analyses, setAnalyses] = useState<ScreenshotAnalysis[]>([]);
  const [commits, setCommits] = useState<GitCommit[]>([]);
  const [commitsLoading, setCommitsLoading] = useState(false);
  const [settings, setSettings] = useState<Settings | null>(null);

  const { startTs, endTs } = dayRangeMs(date);

  useEffect(() => {
    void api.settings.get().then(setSettings).catch(() => setSettings(null));
  }, []);

  async function loadCommits(): Promise<void> {
    setCommitsLoading(true);
    try {
      const list = await api.data.collectCommits(startTs, endTs);
      setCommits(list);
    } catch {
      setCommits([]);
    } finally {
      setCommitsLoading(false);
    }
  }

  useEffect(() => {
    let disposed = false;
    if (tab === 'activity') {
      void api.data
        .getSessions(startTs, endTs)
        .then((list) => !disposed && setSessions(list))
        .catch(() => !disposed && setSessions([]));
      void api.data
        .listManualRecords(startTs, endTs)
        .then((list) => !disposed && setManualRecords(list))
        .catch(() => !disposed && setManualRecords([]));
    } else if (tab === 'screenshots') {
      void api.data
        .getScreenshotAnalyses(startTs, endTs)
        .then((list) => !disposed && setAnalyses(list))
        .catch(() => !disposed && setAnalyses([]));
    } else if (tab === 'commits') {
      void loadCommits();
    }
    return () => {
      disposed = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, date]);

  return (
    <div className="gd-materials">
      <div className="gd-materials__topbar">
        <div className="gd-materials__datenav">
          <Button variant="ghost" size="sm" iconOnly aria-label="前一天" onClick={() => setDate((d) => shiftDateString(d, -1))}>
            <IconChevronLeft size={16} />
          </Button>
          <span className="gd-materials__date-heading">{formatDateHeading(date)}</span>
          <Button variant="ghost" size="sm" iconOnly aria-label="后一天" onClick={() => setDate((d) => shiftDateString(d, 1))}>
            <IconChevronRight size={16} />
          </Button>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ marginLeft: 6 }} />
        </div>
        <SegmentControl options={TAB_OPTIONS} value={tab} onChange={setTab} />
      </div>

      {tab === 'activity' ? <ActivityTab sessions={sessions} manualRecords={manualRecords} /> : null}
      {tab === 'screenshots' ? (
        <ScreenshotsTab analyses={analyses} screenshotsEnabled={settings?.screenshots.enabled ?? true} />
      ) : null}
      {tab === 'commits' ? <CommitsTab commits={commits} refreshing={commitsLoading} onRefresh={() => void loadCommits()} /> : null}
      {tab === 'notes' ? <NotesPanel startTs={startTs} endTs={endTs} title="速记" /> : null}
    </div>
  );
}
