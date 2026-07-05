// 应用记录（DESIGN §13 / SPEC §18.A，替换原「应用时长 Top」区）。
// 区头 SegmentControl（今日/本周/本月/近30天，默认今日）+ 三迷你卡（总应用数/总时长/日均）
// + Top 15 水平条形（沿用现有 .gd-topapps 样式）+ 完整明细表（应用/时长/占比/首次/最后）。
// 自包含：内部管理 period 状态与取数；异常一律降级为空态，绝不白屏/NaN。
import { useEffect, useState, type JSX } from 'react';
import type { AppUsagePeriod, AppUsageSummary } from '@shared/types';
import { CATEGORY_META } from '@shared/categories';
import { api } from '../../api';
import { formatClockTime, formatDuration } from '../../lib/format';
import { CategoryDot } from '../../components/CategoryDot';
import Card from '../../components/Card';
import Button from '../../components/Button';
import EmptyState from '../../components/EmptyState';
import SegmentControl from '../../components/SegmentControl';
import { IllustrationLayers } from '../../components/icons';

const PERIOD_OPTIONS: { value: AppUsagePeriod; label: string }[] = [
  { value: 'today', label: '今日' },
  { value: 'week', label: '本周' },
  { value: 'month', label: '本月' },
  { value: '30d', label: '近 30 天' },
];

/** 明细表最多直出的行数，超出折叠到「展开全部」。 */
const TOP_N = 15;

function emptySummary(period: AppUsagePeriod): AppUsageSummary {
  return { period, totalApps: 0, totalMs: 0, avgDailyMs: 0, apps: [] };
}

/** 首末时间：今日周期只显示 HH:mm，其余周期显示「M月D日 HH:mm」（DESIGN §13）。 */
function formatEdgeTime(ts: number, period: AppUsagePeriod): string {
  const clock = formatClockTime(ts);
  if (period === 'today') return clock;
  const d = new Date(ts);
  return `${d.getMonth() + 1}月${d.getDate()}日 ${clock}`;
}

export default function AppUsage(): JSX.Element {
  const [period, setPeriod] = useState<AppUsagePeriod>('today');
  const [summary, setSummary] = useState<AppUsageSummary>(emptySummary('today'));
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let disposed = false;
    setExpanded(false); // 切换周期时收起明细
    void (async () => {
      try {
        const s = await api.stats.getAppUsage(period);
        if (!disposed) setSummary(s);
      } catch {
        if (!disposed) setSummary(emptySummary(period));
      }
    })();
    return () => {
      disposed = true;
    };
  }, [period]);

  const apps = summary.apps;
  const barRows = apps.slice(0, TOP_N);
  const maxMs = barRows.reduce((m, a) => (a.ms > m ? a.ms : m), 0);
  const tableRows = expanded ? apps : apps.slice(0, TOP_N);

  return (
    <Card
      title="应用记录"
      action={<SegmentControl options={PERIOD_OPTIONS} value={period} onChange={setPeriod} />}
    >
      {apps.length === 0 ? (
        <EmptyState icon={<IllustrationLayers size={44} />} text="这段时间还没有应用使用记录。" />
      ) : (
        <>
          {/* 三迷你卡：总应用数 / 总时长 / 日均 */}
          <div className="gd-appusage__minis">
            <div className="gd-appusage__mini">
              <div className="gd-appusage__mini-value">
                {summary.totalApps}
                <span className="gd-appusage__mini-unit">个</span>
              </div>
              <div className="gd-appusage__mini-caption">总应用数</div>
            </div>
            <div className="gd-appusage__mini">
              <div className="gd-appusage__mini-value">{formatDuration(summary.totalMs)}</div>
              <div className="gd-appusage__mini-caption">总时长</div>
            </div>
            <div className="gd-appusage__mini">
              <div className="gd-appusage__mini-value">{formatDuration(summary.avgDailyMs)}</div>
              <div className="gd-appusage__mini-caption">日均</div>
            </div>
          </div>

          {/* Top 15 水平条形（沿用 .gd-topapps 现有样式） */}
          <div className="gd-topapps">
            {barRows.map((a) => {
              const color = CATEGORY_META[a.category].color;
              const pct = maxMs > 0 ? (a.ms / maxMs) * 100 : 0;
              return (
                <div className="gd-topapps__row" key={a.app}>
                  <div className="gd-topapps__fill" style={{ width: `${pct}%`, background: `${color}99` }} />
                  <span className="gd-topapps__name">
                    <CategoryDot category={a.category} />
                    <span className="gd-topapps__appname">{a.app}</span>
                  </span>
                  <span className="gd-topapps__value gd-mono">{formatDuration(a.ms)}</span>
                </div>
              );
            })}
          </div>

          {/* 完整明细表：应用 / 时长 / 占比 / 首次使用 / 最后使用 */}
          <div className="gd-appusage__tablewrap">
            <table className="gd-appusage__table">
              <thead>
                <tr>
                  <th className="gd-appusage__th-app">应用</th>
                  <th className="gd-appusage__th-num">时长</th>
                  <th className="gd-appusage__th-num">占比</th>
                  <th className="gd-appusage__th-first">首次使用</th>
                  <th className="gd-appusage__th-last">最后使用</th>
                </tr>
              </thead>
              <tbody>
                {tableRows.map((a) => (
                  <tr className="gd-appusage__tr" key={a.app}>
                    <td className="gd-appusage__td-app">
                      <span className="gd-appusage__appcell">
                        <CategoryDot category={a.category} />
                        {a.app}
                      </span>
                    </td>
                    <td className="gd-appusage__td-num gd-mono">{formatDuration(a.ms)}</td>
                    <td className="gd-appusage__td-num gd-mono">{a.pct.toFixed(1)}%</td>
                    <td className="gd-appusage__td-first gd-mono">{formatEdgeTime(a.firstTs, period)}</td>
                    <td className="gd-appusage__td-last gd-mono">{formatEdgeTime(a.lastTs, period)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* >15 行折叠：底部居中幽灵按钮 */}
          {apps.length > TOP_N && !expanded ? (
            <div className="gd-appusage__expand">
              <Button variant="ghost" size="sm" onClick={() => setExpanded(true)}>
                展开全部 {apps.length} 个应用
              </Button>
            </div>
          ) : null}
        </>
      )}
    </Card>
  );
}
