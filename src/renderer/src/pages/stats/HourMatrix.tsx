// 时段分布（DESIGN §9-3）：7 行（周一…周日）×24 列网格，同色阶。行标 12px，列标每 3h 一个。副标题「近 30 天」。
import { Fragment, useState, type JSX, type MouseEvent } from 'react';
import Card from '../../components/Card';
import EmptyState from '../../components/EmptyState';
import { IllustrationLayers } from '../../components/icons';
import { formatDuration } from '../../lib/format';
import { heatColor, levelRelative } from './heat';

const WEEKDAY_LABELS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
const HOUR_TICKS = [0, 3, 6, 9, 12, 15, 18, 21];
const HOURS = Array.from({ length: 24 }, (_, h) => h);

interface FloatTip {
  text: string;
  x: number;
  y: number;
}

export default function HourMatrix({ matrix }: { matrix: number[][] }): JSX.Element {
  const [tip, setTip] = useState<FloatTip | null>(null);

  let max = 0;
  for (const row of matrix) {
    for (const v of row) {
      if (v > max) max = v;
    }
  }
  const hasData = max > 0;

  function showTip(e: MouseEvent, weekdayLabel: string, hour: number, value: number): void {
    const hh = String(hour).padStart(2, '0');
    setTip({ text: `${weekdayLabel} ${hh}:00 · 活跃 ${formatDuration(value)}`, x: e.clientX, y: e.clientY });
  }

  return (
    <Card title="时段分布" subtitle="近 30 天">
      {!hasData ? (
        <EmptyState icon={<IllustrationLayers size={44} />} text="还没有足够的记录，无法描绘你的一周作息分布。" />
      ) : (
        <div className="gd-hourgrid">
          <div className="gd-hourgrid__corner" />
          <div className="gd-hourgrid__hours">
            {HOUR_TICKS.map((h) => (
              <span key={h} className="gd-hourgrid__hour" style={{ gridColumn: h + 1 }}>
                {h}
              </span>
            ))}
          </div>
          {WEEKDAY_LABELS.map((label, w) => {
            const row = matrix[w] ?? [];
            return (
              <Fragment key={label}>
                <div className="gd-hourgrid__rowlabel">{label}</div>
                <div className="gd-hourgrid__cells">
                  {HOURS.map((h) => {
                    const value = row[h] ?? 0;
                    return (
                      <div
                        key={h}
                        className="gd-hourgrid__cell"
                        style={{ background: heatColor(levelRelative(value, max)) }}
                        onMouseEnter={(e) => showTip(e, label, h, value)}
                        onMouseMove={(e) => showTip(e, label, h, value)}
                        onMouseLeave={() => setTip(null)}
                      />
                    );
                  })}
                </div>
              </Fragment>
            );
          })}
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
