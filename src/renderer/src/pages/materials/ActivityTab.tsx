// 素材页 - 活动 tab（DESIGN §5）：表格风列表，>100 条按小时折叠分组。
import { useMemo, useState, type JSX } from 'react';
import type { Session } from '@shared/types';
import { formatClockTime, formatDuration, truncate } from '../../lib/format';
import { CategoryDot } from '../../components/CategoryDot';
import EmptyState from '../../components/EmptyState';
import { IconChevronDown, IllustrationLayers } from '../../components/icons';
import Card from '../../components/Card';
import './ActivityTab.css';

const GROUP_THRESHOLD = 100;

function hourKeyOf(ts: number): number {
  return new Date(ts).getHours();
}

function ActivityRow({ session }: { session: Session }): JSX.Element {
  return (
    <div className="gd-activity__row">
      <span className="gd-activity__time gd-mono">
        {formatClockTime(session.startTs)}–{formatClockTime(session.endTs)}
      </span>
      <span className="gd-activity__app">
        <CategoryDot category={session.category} />
        {session.app || '(未授权)'}
      </span>
      <span className="gd-activity__title">{truncate(session.title, 60)}</span>
      <span className="gd-activity__duration gd-mono">{formatDuration(session.endTs - session.startTs)}</span>
    </div>
  );
}

export default function ActivityTab({ sessions }: { sessions: Session[] }): JSX.Element {
  const sorted = useMemo(() => [...sessions].sort((a, b) => a.startTs - b.startTs), [sessions]);
  const grouped = sorted.length > GROUP_THRESHOLD;

  const groups = useMemo(() => {
    if (!grouped) return [];
    const map = new Map<number, Session[]>();
    for (const s of sorted) {
      const h = hourKeyOf(s.startTs);
      const list = map.get(h) ?? [];
      list.push(s);
      map.set(h, list);
    }
    return Array.from(map.entries()).sort((a, b) => a[0] - b[0]);
  }, [grouped, sorted]);

  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  function toggle(hour: number): void {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(hour)) next.delete(hour);
      else next.add(hour);
      return next;
    });
  }

  if (sorted.length === 0) {
    return (
      <Card>
        <EmptyState icon={<IllustrationLayers />} text="这一天还没有活动记录。" />
      </Card>
    );
  }

  return (
    <Card>
      <div className="gd-activity__head">
        <span style={{ width: 108 }}>时间段</span>
        <span style={{ width: 130 }}>应用</span>
        <span style={{ flex: 1 }}>标题</span>
        <span style={{ width: 64, textAlign: 'right' }}>时长</span>
      </div>
      {grouped
        ? groups.map(([hour, list]) => (
            <div key={hour}>
              <div className="gd-activity__hour-head" onClick={() => toggle(hour)}>
                <IconChevronDown
                  size={14}
                  className="gd-activity__hour-chevron"
                  style={{ transform: expanded.has(hour) ? 'rotate(180deg)' : undefined }}
                />
                {String(hour).padStart(2, '0')}:00–{String(hour + 1).padStart(2, '0')}:00
                <span className="gd-activity__hour-count">· {list.length} 条</span>
              </div>
              {expanded.has(hour) ? list.map((s) => <ActivityRow session={s} key={s.id} />) : null}
            </div>
          ))
        : sorted.map((s) => <ActivityRow session={s} key={s.id} />)}
    </Card>
  );
}
