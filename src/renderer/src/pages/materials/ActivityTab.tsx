// 素材页 - 活动 tab（DESIGN §5 / §17.C）：表格风列表，session 与手动记录按时间混排，>100 条按小时折叠分组。
import { useMemo, useState, type JSX } from 'react';
import type { ManualRecord, Session } from '@shared/types';
import { formatClockTime, formatDuration, truncate } from '../../lib/format';
import { CategoryDot } from '../../components/CategoryDot';
import EmptyState from '../../components/EmptyState';
import { IconChevronDown, IllustrationLayers } from '../../components/icons';
import Card from '../../components/Card';
import './ActivityTab.css';

const GROUP_THRESHOLD = 100;

type Item = { kind: 'session'; ts: number; session: Session } | { kind: 'manual'; ts: number; record: ManualRecord };

function hourKeyOf(ts: number): number {
  return new Date(ts).getHours();
}

function SessionRow({ session }: { session: Session }): JSX.Element {
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

function ManualRow({ record }: { record: ManualRecord }): JSX.Element {
  const badge = record.source === 'image' ? '🖼 图片' : '✎ 补录';
  const text = record.title ? `${record.title} · ${record.content}` : record.content;
  return (
    <div className="gd-activity__row">
      <span className="gd-activity__time gd-mono">{formatClockTime(record.ts)}</span>
      <span className="gd-activity__app">
        <CategoryDot category={record.category} />
        <span className="gd-activity__badge">{badge}</span>
      </span>
      <span className="gd-activity__title">{truncate(text, 80)}</span>
      <span className="gd-activity__duration gd-mono">—</span>
    </div>
  );
}

function ItemRow({ item }: { item: Item }): JSX.Element {
  return item.kind === 'session' ? <SessionRow session={item.session} /> : <ManualRow record={item.record} />;
}

export default function ActivityTab({ sessions, manualRecords }: { sessions: Session[]; manualRecords: ManualRecord[] }): JSX.Element {
  const items = useMemo<Item[]>(() => {
    const merged: Item[] = [
      ...sessions.map((s) => ({ kind: 'session' as const, ts: s.startTs, session: s })),
      ...manualRecords.map((r) => ({ kind: 'manual' as const, ts: r.ts, record: r })),
    ];
    return merged.sort((a, b) => a.ts - b.ts);
  }, [sessions, manualRecords]);

  const grouped = items.length > GROUP_THRESHOLD;

  const groups = useMemo(() => {
    if (!grouped) return [];
    const map = new Map<number, Item[]>();
    for (const it of items) {
      const h = hourKeyOf(it.ts);
      const list = map.get(h) ?? [];
      list.push(it);
      map.set(h, list);
    }
    return Array.from(map.entries()).sort((a, b) => a[0] - b[0]);
  }, [grouped, items]);

  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  function toggle(hour: number): void {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(hour)) next.delete(hour);
      else next.add(hour);
      return next;
    });
  }

  function keyOf(item: Item): string {
    return item.kind === 'session' ? `s-${item.session.id}` : `m-${item.record.id}`;
  }

  if (items.length === 0) {
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
                <IconChevronDown size={14} className="gd-activity__hour-chevron" style={{ transform: expanded.has(hour) ? 'rotate(180deg)' : undefined }} />
                {String(hour).padStart(2, '0')}:00–{String(hour + 1).padStart(2, '0')}:00
                <span className="gd-activity__hour-count">· {list.length} 条</span>
              </div>
              {expanded.has(hour) ? list.map((it) => <ItemRow item={it} key={keyOf(it)} />) : null}
            </div>
          ))
        : items.map((it) => <ItemRow item={it} key={keyOf(it)} />)}
    </Card>
  );
}
