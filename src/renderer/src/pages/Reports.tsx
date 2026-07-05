// 报告页（DESIGN §4）：左列生成器+历史，右侧纸感预览编辑。
import { useCallback, useEffect, useState, type JSX } from 'react';
import type { Report, ReportDetailLevel, ReportGenOptions, ReportTemplate } from '@shared/types';
import { api } from '../api';
import { todayDateString } from '../lib/format';
import { parseHashQuery, stripHashQuery, subscribeAppNavigate } from '../lib/navigate';
import { useToast } from '../components/Toast';
import Generator, { type GeneratingStage, type GeneratorState } from './reports/Generator';
import HistoryList from './reports/HistoryList';
import PreviewPane from './reports/PreviewPane';
import './Reports.css';

const DEFAULT_TEMPLATE: ReportTemplate = 'standard';
const DEFAULT_DETAIL: ReportDetailLevel = 'standard';

export default function Reports(): JSX.Element {
  const { showToast } = useToast();
  const [genState, setGenState] = useState<GeneratorState>({
    type: 'daily',
    date: todayDateString(),
    template: DEFAULT_TEMPLATE,
    detail: DEFAULT_DETAIL,
    extraInstructions: '',
  });
  const [stage, setStage] = useState<GeneratingStage>('idle');
  const [reports, setReports] = useState<Report[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const refreshList = useCallback(async (selectId?: number): Promise<void> => {
    try {
      const list = await api.reports.list();
      setReports(list);
      setSelectedId((prev) => {
        if (selectId !== undefined) return selectId;
        if (prev !== null && list.some((r) => r.id === prev)) return prev;
        const sorted = [...list].sort((a, b) => b.createdTs - a.createdTs);
        const first = sorted[0];
        return first ? first.id : null;
      });
    } catch {
      setReports([]);
      setSelectedId(null);
    }
  }, []);

  useEffect(() => {
    void refreshList();
  }, [refreshList]);

  // 初始化「详略」默认值：读 settings.report.defaultDetail（DESIGN §14），失败则保持 standard。
  useEffect(() => {
    let disposed = false;
    void (async () => {
      try {
        const s = await api.settings.get();
        if (!disposed) setGenState((prev) => ({ ...prev, detail: s.report.defaultDetail }));
      } catch {
        // 读设置失败：保持默认 standard。
      }
    })();
    return () => {
      disposed = true;
    };
  }, []);

  useEffect(() => {
    const unsubscribe = api.reports.onProgress((p) => {
      if (p.stage === 'collecting') setStage('collecting');
      else if (p.stage === 'generating') setStage('generating');
      else if (p.stage === 'done') {
        setStage('idle');
        void refreshList(p.reportId);
        showToast('日报已生成', 'success');
      } else if (p.stage === 'error') {
        setStage('idle');
        showToast(p.message, 'error');
      }
    });
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshList]);

  function runGenerate(opts: ReportGenOptions): void {
    setStage('collecting');
    api.reports.generate(opts).catch((e: unknown) => {
      setStage('idle');
      showToast(e instanceof Error ? e.message : '生成失败，请重试', 'error');
    });
  }

  // 自动生成兜底：两条路径都做——
  // 1) Today 页 CTA 通过 hash 查询参数 `#/reports?autoGenerate=1&date=...` 跳转过来（始终可靠）。
  // 2) 特性探测：若主进程/preload 未来扩展了 app.onNavigate（例如托盘菜单），存在则直接可用。
  useEffect(() => {
    const query = parseHashQuery(window.location.hash);
    if (query.get('autoGenerate') === '1') {
      const date = query.get('date') ?? todayDateString();
      window.history.replaceState(null, '', stripHashQuery(window.location.hash) || '#/reports');
      setGenState((prev) => ({ ...prev, type: 'daily', date }));
      runGenerate({ type: 'daily', date, template: DEFAULT_TEMPLATE });
    }
    const unsubscribeNav = subscribeAppNavigate((payload) => {
      if (payload.page === 'reports' && payload.autoGenerate) {
        const date = payload.date ?? todayDateString();
        setGenState((prev) => ({ ...prev, type: 'daily', date }));
        runGenerate({ type: 'daily', date, template: DEFAULT_TEMPLATE });
      }
    });
    return unsubscribeNav;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleGenerate(): void {
    if (stage !== 'idle') return;
    runGenerate({
      type: genState.type,
      date: genState.date,
      template: genState.template,
      detail: genState.detail,
      extraInstructions: genState.extraInstructions.trim() || undefined,
    });
  }

  function handleDelete(id: number): void {
    setReports((prev) => prev.filter((r) => r.id !== id));
    setSelectedId((prev) => (prev === id ? null : prev));
    api.reports.remove(id).catch(() => void refreshList());
  }

  function handleSaved(id: number, contentMd: string): void {
    setReports((prev) => prev.map((r) => (r.id === id ? { ...r, contentMd } : r)));
  }

  const selectedReport = reports.find((r) => r.id === selectedId) ?? null;

  return (
    <div className="gd-reports">
      <div className="gd-reports__left">
        <Generator state={genState} onChange={setGenState} stage={stage} onGenerate={handleGenerate} />
        <HistoryList reports={reports} selectedId={selectedId} onSelect={setSelectedId} onDelete={handleDelete} />
      </div>
      <div className="gd-reports__right">
        <PreviewPane report={selectedReport} onSaved={handleSaved} />
      </div>
    </div>
  );
}
