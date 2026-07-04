// 三张统计卡（DESIGN §3-2）：专注时长 / 最长专注块 / 上下文切换（含评语）。
import type { JSX } from 'react';
import type { DayStats } from '@shared/types';
import { CATEGORY_META } from '@shared/categories';
import { formatClockTime, formatDuration } from '../../lib/format';
import Card from '../../components/Card';
import './StatsCards.css';

function switchEvaluation(n: number): string {
  if (n < 30) return '心流不错';
  if (n <= 80) return '中等碎片化';
  return '今天有点碎';
}

function longestBlockText(stats: DayStats): { value: string; caption: string } {
  if (stats.focusBlocks.length === 0) return { value: '-', caption: '暂无专注块' };
  const longest = stats.focusBlocks.reduce((best, b) => (b.endTs - b.startTs > best.endTs - best.startTs ? b : best));
  const duration = formatDuration(longest.endTs - longest.startTs);
  const caption = `${formatClockTime(longest.startTs)} ${CATEGORY_META[longest.category].label}`;
  return { value: duration, caption };
}

export default function StatsCards({ stats }: { stats: DayStats }): JSX.Element {
  const longest = longestBlockText(stats);

  return (
    <div className="gd-stats-row">
      <Card>
        <div className="gd-stat-card__value">{formatDuration(stats.totalActiveMs)}</div>
        <div className="gd-stat-card__caption">活跃总时长</div>
      </Card>
      <Card>
        <div className="gd-stat-card__value">{longest.value}</div>
        <div className="gd-stat-card__caption">{longest.caption}</div>
      </Card>
      <Card>
        <div className="gd-stat-card__value">{stats.contextSwitches} 次</div>
        <div className="gd-stat-card__caption">上下文切换 · {switchEvaluation(stats.contextSwitches)}</div>
      </Card>
    </div>
  );
}
