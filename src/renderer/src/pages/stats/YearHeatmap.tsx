// 年度热力图（DESIGN §9-2）：GitHub 风格 53×7 网格，格子 11px / 圆角 2px / 间距 3px。
// 列 = 周（周一在最上），5 档强度色阶，hover 浮层「M月D日 · 活跃 Xh Ym」，横向月份刻度，容器横向可滚动。
import { useState, type JSX, type MouseEvent } from 'react';
import type { HeatmapDay } from '@shared/types';
import { formatDuration } from '../../lib/format';
import Card from '../../components/Card';
import EmptyState from '../../components/EmptyState';
import { IllustrationLayers } from '../../components/icons';
import { heatColor, levelForDay, parseLocalDate } from './heat';

interface FloatTip {
  text: string;
  x: number;
  y: number;
}

/** 图例「少 ▢▢▢▢▢ 多」（DESIGN §9-2）。 */
function Legend(): JSX.Element {
  return (
    <div className="gd-heatmap__legend">
      <span className="gd-heatmap__legend-label">少</span>
      {[0, 1, 2, 3, 4].map((l) => (
        <span key={l} className="gd-heatmap__legend-box" style={{ background: heatColor(l) }} />
      ))}
      <span className="gd-heatmap__legend-label">多</span>
    </div>
  );
}

/** 前置空位（首日之前）+ 全部日格，按列优先（grid-auto-flow: column）顺序排布，周一在每列顶部。 */
function buildCells(days: HeatmapDay[]): (HeatmapDay | null)[] {
  if (days.length === 0) return [];
  const first = days[0];
  if (!first) return [];
  const leading = (parseLocalDate(first.date).date.getDay() + 6) % 7; // 周一=0
  const out: (HeatmapDay | null)[] = [];
  for (let i = 0; i < leading; i++) out.push(null);
  for (const d of days) out.push(d);
  return out;
}

export default function YearHeatmap({ days }: { days: HeatmapDay[] }): JSX.Element {
  const [tip, setTip] = useState<FloatTip | null>(null);

  const total = days.reduce((sum, d) => sum + (d.activeMs > 0 ? d.activeMs : 0), 0);
  const cells = buildCells(days);
  const numCols = Math.ceil(cells.length / 7);

  // 月份刻度：某列出现新月份的第一天时，在该列上标注月份。
  const monthLabels: { col: number; label: string }[] = [];
  let lastMonth = -1;
  for (let c = 0; c < numCols; c++) {
    for (let r = 0; r < 7; r++) {
      const cell = cells[c * 7 + r];
      if (cell) {
        const { m } = parseLocalDate(cell.date);
        if (m !== lastMonth) {
          monthLabels.push({ col: c, label: `${m}月` });
          lastMonth = m;
        }
        break;
      }
    }
  }

  function showTip(e: MouseEvent, day: HeatmapDay): void {
    const { m, d } = parseLocalDate(day.date);
    setTip({ text: `${m}月${d}日 · 活跃 ${formatDuration(day.activeMs)}`, x: e.clientX, y: e.clientY });
  }

  return (
    <Card title="年度活跃" action={<Legend />}>
      {total <= 0 ? (
        <EmptyState icon={<IllustrationLayers size={44} />} text="还没有足够的记录。坚持记录，这里会慢慢长出一整年的痕迹。" />
      ) : (
        <div className="gd-heatmap__scroll">
          <div className="gd-heatmap">
            <div className="gd-heatmap__months" style={{ gridTemplateColumns: `repeat(${numCols}, 11px)` }}>
              {monthLabels.map((ml) => (
                <span key={`${ml.col}-${ml.label}`} className="gd-heatmap__month" style={{ gridColumn: ml.col + 1 }}>
                  {ml.label}
                </span>
              ))}
            </div>
            <div className="gd-heatmap__grid">
              {cells.map((cell, i) =>
                cell ? (
                  <div
                    key={cell.date}
                    className="gd-heatmap__cell"
                    style={{ background: heatColor(levelForDay(cell.activeMs)) }}
                    onMouseEnter={(e) => showTip(e, cell)}
                    onMouseMove={(e) => showTip(e, cell)}
                    onMouseLeave={() => setTip(null)}
                  />
                ) : (
                  <div key={`void-${i}`} className="gd-heatmap__cell gd-heatmap__cell--void" />
                ),
              )}
            </div>
          </div>
        </div>
      )}
      {tip ? (
        <div className="gd-stats__floattip" style={{ left: tip.x, top: tip.y }}>
          {tip.text}
        </div>
      ) : null}
    </Card>
  );
}
