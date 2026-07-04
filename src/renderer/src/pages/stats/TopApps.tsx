// 应用时长 Top（DESIGN §9-4）：周期 SegmentControl（近 7 天/近 30 天）。
// 每行：分类色点 + app 名 + 右对齐时长；底层水平条（--bg-sunken 上叠分类色 60%，宽度=占比）。最多 15 行，空态用 EmptyState。
import type { JSX } from 'react';
import type { TopApp } from '@shared/types';
import { CATEGORY_META } from '@shared/categories';
import { formatDuration } from '../../lib/format';
import { CategoryDot } from '../../components/CategoryDot';
import Card from '../../components/Card';
import EmptyState from '../../components/EmptyState';
import SegmentControl from '../../components/SegmentControl';
import { IllustrationLayers } from '../../components/icons';

export type TopDays = 7 | 30;

const DAY_OPTIONS = [
  { value: '7', label: '近 7 天' },
  { value: '30', label: '近 30 天' },
];

export default function TopApps({
  apps,
  days,
  onDaysChange,
}: {
  apps: TopApp[];
  days: TopDays;
  onDaysChange: (d: TopDays) => void;
}): JSX.Element {
  const rows = apps.slice(0, 15);
  const max = rows.reduce((m, a) => (a.ms > m ? a.ms : m), 0);

  return (
    <Card
      title="应用时长 Top"
      action={
        <SegmentControl
          options={DAY_OPTIONS}
          value={String(days)}
          onChange={(v) => onDaysChange(v === '30' ? 30 : 7)}
        />
      }
    >
      {rows.length === 0 ? (
        <EmptyState icon={<IllustrationLayers size={44} />} text="这段时间还没有应用使用记录。" />
      ) : (
        <div className="gd-topapps">
          {rows.map((a) => {
            const color = CATEGORY_META[a.category].color;
            const pct = max > 0 ? (a.ms / max) * 100 : 0;
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
      )}
    </Card>
  );
}
