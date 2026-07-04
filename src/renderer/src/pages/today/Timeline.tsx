// 今日页核心视觉：横向时间线（DESIGN §3-1）。默认视窗 08:00-22:00，超出范围有数据时自动扩展。
import type { JSX } from 'react';
import type { Category, Session } from '@shared/types';
import { CATEGORY_META } from '@shared/categories';
import { clamp, dayRangeMs, formatClockTime, formatDuration, fractionOfDay, truncate } from '../../lib/format';
import { CategoryDot } from '../../components/CategoryDot';
import EmptyState from '../../components/EmptyState';
import { IllustrationTea } from '../../components/icons';
import Card from '../../components/Card';
import './Timeline.css';

const DEFAULT_START_HOUR = 8;
const DEFAULT_END_HOUR = 22;
const HOUR_MS = 3600 * 1000;

function floorToHour(ts: number): number {
  const d = new Date(ts);
  d.setMinutes(0, 0, 0);
  return d.getTime();
}

function ceilToHour(ts: number): number {
  const d = new Date(ts);
  if (d.getMinutes() !== 0 || d.getSeconds() !== 0 || d.getMilliseconds() !== 0) {
    d.setHours(d.getHours() + 1);
  }
  d.setMinutes(0, 0, 0);
  return d.getTime();
}

interface ViewRange {
  dayStart: number;
  dayEnd: number;
  viewStart: number;
  viewEnd: number;
}

function computeViewRange(date: string, sessions: Session[]): ViewRange {
  const { startTs: dayStart, endTs: dayEnd } = dayRangeMs(date);
  let viewStart = dayStart + DEFAULT_START_HOUR * HOUR_MS;
  let viewEnd = dayStart + DEFAULT_END_HOUR * HOUR_MS;
  for (const s of sessions) {
    const st = clamp(s.startTs, dayStart, dayEnd);
    const et = clamp(s.endTs, dayStart, dayEnd);
    if (st < viewStart) viewStart = floorToHour(st);
    if (et > viewEnd) viewEnd = ceilToHour(et);
  }
  return { dayStart, dayEnd, viewStart, viewEnd };
}

function computeTicks(range: ViewRange): number[] {
  const startHour = new Date(range.viewStart).getHours();
  const alignedStartHour = Math.floor(startHour / 4) * 4;
  const ticks: number[] = [];
  let t = range.dayStart + alignedStartHour * HOUR_MS;
  while (t <= range.viewEnd) {
    if (t >= range.viewStart) ticks.push(t);
    t += 4 * HOUR_MS;
  }
  return ticks;
}

export default function Timeline({ date, sessions, permissionDenied }: { date: string; sessions: Session[]; permissionDenied: boolean }): JSX.Element {
  const range = computeViewRange(date, sessions);
  const ticks = computeTicks(range);

  const categoriesPresent = Array.from(new Set(sessions.map((s) => s.category))) as Category[];
  categoriesPresent.sort((a, b) => (CATEGORY_META[a].label > CATEGORY_META[b].label ? 1 : -1));

  const blocks = sessions
    .map((s) => {
      const st = clamp(s.startTs, range.dayStart, range.dayEnd);
      const et = clamp(s.endTs, range.dayStart, range.dayEnd);
      const leftPct = fractionOfDay(st, range.viewStart, range.viewEnd) * 100;
      const rightPct = fractionOfDay(et, range.viewStart, range.viewEnd) * 100;
      const widthPct = Math.max(0, rightPct - leftPct);
      return { session: s, leftPct, widthPct, st, et };
    })
    .filter((b) => b.widthPct > 0 || (b.et > b.st && b.leftPct < 100));

  return (
    <Card
      title="今日时间线"
      action={
        categoriesPresent.length > 0 ? (
          <div className="gd-timeline__legend">
            {categoriesPresent.map((c) => (
              <span className="gd-timeline__legend-item" key={c}>
                <CategoryDot category={c} />
                {CATEGORY_META[c].label}
              </span>
            ))}
          </div>
        ) : null
      }
    >
      {permissionDenied ? (
        <div className="gd-timeline__banner">
          <span>需要「自动化」权限才能记录前台应用</span>
          <a href="#/settings" className="gd-mono" style={{ color: 'var(--accent)', fontSize: 13, textDecoration: 'none', fontFamily: 'var(--font-sans)' }}>
            前往设置 →
          </a>
        </div>
      ) : null}
      {sessions.length === 0 ? (
        <EmptyState icon={<IllustrationTea />} text="还没有记录。保持这个窗口之外的任何工作，拾光会安静地记下来。" />
      ) : (
        <div className="gd-timeline__track-wrap">
          <div className="gd-timeline__track">
            {blocks.map(({ session, leftPct, widthPct, st, et }) => {
              // 边界感知：贴近轨道两端的块，tooltip 改为左/右对齐锚点，避免浮层被裁切出卡片。
              const center = leftPct + widthPct / 2;
              const anchor = center < 12 ? 'left' : center > 88 ? 'right' : 'center';
              return (
                <div
                  className="gd-timeline__block"
                  key={session.id}
                  style={{ left: `${leftPct}%`, width: `${Math.max(widthPct, 0.15)}%`, background: CATEGORY_META[session.category].color }}
                >
                  <div className="gd-timeline__block-tip" data-anchor={anchor}>
                    <div className="gd-timeline__tip-title">{session.app || '(未授权)'}</div>
                    {session.title ? <div className="gd-timeline__tip-sub">{truncate(session.title, 36)}</div> : null}
                    <div className="gd-timeline__tip-sub gd-mono">
                      {formatClockTime(st)}–{formatClockTime(et)} · {formatDuration(et - st)}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="gd-timeline__ticks">
            {ticks.map((t) => (
              <span
                className="gd-timeline__tick gd-mono"
                key={t}
                style={{ left: `${fractionOfDay(t, range.viewStart, range.viewEnd) * 100}%` }}
              >
                {formatClockTime(t)}
              </span>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}
