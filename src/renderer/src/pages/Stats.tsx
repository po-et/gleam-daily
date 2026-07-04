// 统计页（DESIGN §9 / SPEC §17.B）：概览 4 卡 + 年度热力图 + 时段分布 + 应用时长 Top。
// 数据全部走 api.stats.*；主进程 handler 由并行 agent 实现，此处以契约类型为准，异常一律降级为空态，绝不白屏/NaN。
import { useEffect, useState, type JSX } from 'react';
import type { HeatmapDay, StatsOverview, TopApp } from '@shared/types';
import { api } from '../api';
import OverviewCards from './stats/OverviewCards';
import YearHeatmap from './stats/YearHeatmap';
import HourMatrix from './stats/HourMatrix';
import TopApps, { type TopDays } from './stats/TopApps';
import './Stats.css';

const EMPTY_OVERVIEW: StatsOverview = {
  streakDays: 0,
  totalActiveDays: 0,
  avgDailyActiveMs30d: 0,
  totalSessions: 0,
  totalScreenshots: 0,
  totalReports: 0,
};

const HEATMAP_DAYS = 365;
const HOUR_MATRIX_DAYS = 30;

export default function Stats(): JSX.Element {
  const [overview, setOverview] = useState<StatsOverview>(EMPTY_OVERVIEW);
  const [heatmap, setHeatmap] = useState<HeatmapDay[]>([]);
  const [hourMatrix, setHourMatrix] = useState<number[][]>([]);
  const [topApps, setTopApps] = useState<TopApp[]>([]);
  const [topDays, setTopDays] = useState<TopDays>(7);

  useEffect(() => {
    let disposed = false;
    void (async () => {
      try {
        const o = await api.stats.getOverview();
        if (!disposed) setOverview(o);
      } catch {
        if (!disposed) setOverview(EMPTY_OVERVIEW);
      }
    })();
    void (async () => {
      try {
        const h = await api.stats.getHeatmap(HEATMAP_DAYS);
        if (!disposed) setHeatmap(h);
      } catch {
        if (!disposed) setHeatmap([]);
      }
    })();
    void (async () => {
      try {
        const m = await api.stats.getHourMatrix(HOUR_MATRIX_DAYS);
        if (!disposed) setHourMatrix(m);
      } catch {
        if (!disposed) setHourMatrix([]);
      }
    })();
    return () => {
      disposed = true;
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    void (async () => {
      try {
        const t = await api.stats.getTopApps(topDays);
        if (!disposed) setTopApps(t);
      } catch {
        if (!disposed) setTopApps([]);
      }
    })();
    return () => {
      disposed = true;
    };
  }, [topDays]);

  return (
    <div className="gd-stats">
      <div className="gd-stats__header">
        <h1 className="gd-stats__title">统计</h1>
        <div className="gd-stats__subline">回望这段时间的工作节律。</div>
      </div>

      <OverviewCards overview={overview} />
      <YearHeatmap days={heatmap} />
      <HourMatrix matrix={hourMatrix} />
      <TopApps apps={topApps} days={topDays} onDaysChange={setTopDays} />
    </div>
  );
}
