// 分类分布（DESIGN §3-3 左栏）：每分类一行，色点+label+横向细条+右侧时长。
import type { JSX } from 'react';
import type { Category, DayStats } from '@shared/types';
import { CATEGORY_META } from '@shared/categories';
import { formatDuration } from '../lib/format';
import { CategoryDot } from './CategoryDot';
import Card from './Card';
import EmptyState from './EmptyState';
import { IllustrationLayers } from './icons';
import './CategoryBreakdown.css';

export default function CategoryBreakdown({ byCategory }: { byCategory: DayStats['byCategory'] }): JSX.Element {
  const entries = (Object.entries(byCategory) as [Category, number | undefined][])
    .filter((entry): entry is [Category, number] => (entry[1] ?? 0) > 0)
    .sort((a, b) => b[1] - a[1]);

  const max = entries.length > 0 ? Math.max(...entries.map(([, ms]) => ms)) : 0;

  return (
    <Card title="分类分布">
      {entries.length === 0 ? (
        <EmptyState icon={<IllustrationLayers size={44} />} text="今天还没有分类数据。" />
      ) : (
        entries.map(([category, ms]) => (
          <div className="gd-breakdown__row" key={category}>
            <span className="gd-breakdown__label">
              <CategoryDot category={category} />
              {CATEGORY_META[category].label}
            </span>
            <div className="gd-breakdown__bar-track">
              <div
                className="gd-breakdown__bar-fill"
                style={{ width: `${max > 0 ? (ms / max) * 100 : 0}%`, background: CATEGORY_META[category].color }}
              />
            </div>
            <span className="gd-breakdown__value gd-mono">{formatDuration(ms)}</span>
          </div>
        ))
      )}
    </Card>
  );
}
