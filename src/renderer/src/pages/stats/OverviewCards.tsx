// 概览卡片行（DESIGN §9-1）：4 张等宽小卡。数字 serif 28px，标签 12.5px --text-3。
// 连续记录 streak>=3 时数字用 --accent。
import type { JSX } from 'react';
import type { StatsOverview } from '@shared/types';
import { formatDuration } from '../../lib/format';
import Card from '../../components/Card';

export default function OverviewCards({ overview }: { overview: StatsOverview }): JSX.Element {
  const streakAccent = overview.streakDays >= 3;
  return (
    <div className="gd-stats__overview">
      <Card>
        <div className="gd-stats__ov-value" data-accent={streakAccent}>
          {overview.streakDays}
          <span className="gd-stats__ov-unit">天</span>
        </div>
        <div className="gd-stats__ov-caption">连续记录</div>
      </Card>
      <Card>
        <div className="gd-stats__ov-value">
          {overview.totalActiveDays}
          <span className="gd-stats__ov-unit">天</span>
        </div>
        <div className="gd-stats__ov-caption">累计活跃</div>
      </Card>
      <Card>
        <div className="gd-stats__ov-value">{formatDuration(overview.avgDailyActiveMs30d)}</div>
        <div className="gd-stats__ov-caption">近 30 天日均</div>
      </Card>
      <Card>
        <div className="gd-stats__ov-value">
          {overview.totalReports}
          <span className="gd-stats__ov-unit">篇</span>
        </div>
        <div className="gd-stats__ov-caption">累计报告</div>
      </Card>
    </div>
  );
}
