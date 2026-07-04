// 今日页核心视觉：横向时间线（DESIGN §3-1 / §10）。默认视窗 08:00-22:00，超出范围有数据时自动扩展。
// v1.3：session 块 hover 可改分类/删除；手动记录（✎/🖼）与 session 块按时间混排，hover 展示内容并可编辑/删除。
import { useState, type JSX } from 'react';
import type { Category, ManualRecord, Session } from '@shared/types';
import { CATEGORY_META } from '@shared/categories';
import { api } from '../../api';
import { clamp, dayRangeMs, formatClockTime, formatDuration, fractionOfDay, truncate } from '../../lib/format';
import { CategoryDot } from '../../components/CategoryDot';
import EmptyState from '../../components/EmptyState';
import { IconChevronDown, IconClose, IconPencil, IllustrationTea } from '../../components/icons';
import Card from '../../components/Card';
import Modal from '../../components/Modal';
import './Timeline.css';

const DEFAULT_START_HOUR = 8;
const DEFAULT_END_HOUR = 22;
const HOUR_MS = 3600 * 1000;
const CATEGORY_ORDER: Category[] = ['dev', 'meeting', 'comm', 'docs', 'design', 'research', 'leisure', 'other'];

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

function computeViewRange(date: string, sessions: Session[], manualRecords: ManualRecord[]): ViewRange {
  const { startTs: dayStart, endTs: dayEnd } = dayRangeMs(date);
  let viewStart = dayStart + DEFAULT_START_HOUR * HOUR_MS;
  let viewEnd = dayStart + DEFAULT_END_HOUR * HOUR_MS;
  for (const s of sessions) {
    const st = clamp(s.startTs, dayStart, dayEnd);
    const et = clamp(s.endTs, dayStart, dayEnd);
    if (st < viewStart) viewStart = floorToHour(st);
    if (et > viewEnd) viewEnd = ceilToHour(et);
  }
  for (const r of manualRecords) {
    const t = clamp(r.ts, dayStart, dayEnd);
    if (t < viewStart) viewStart = floorToHour(t);
    if (t > viewEnd) viewEnd = ceilToHour(t);
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

function anchorOf(centerPct: number): 'left' | 'center' | 'right' {
  return centerPct < 12 ? 'left' : centerPct > 88 ? 'right' : 'center';
}

interface SessionBlockData {
  session: Session;
  leftPct: number;
  widthPct: number;
  st: number;
  et: number;
}

function SessionBlock({
  block,
  menuOpen,
  onToggleMenu,
  onPick,
  onDelete,
  disabled,
}: {
  block: SessionBlockData;
  menuOpen: boolean;
  onToggleMenu: () => void;
  onPick: (category: Category) => void;
  onDelete: () => void;
  disabled: boolean;
}): JSX.Element {
  const { session, leftPct, widthPct, st, et } = block;
  const anchor = anchorOf(leftPct + widthPct / 2);
  return (
    <div className="gd-timeline__block-wrap" style={{ left: `${leftPct}%`, width: `${Math.max(widthPct, 0.15)}%` }}>
      <div className="gd-timeline__bar" style={{ background: CATEGORY_META[session.category].color }} />
      <div className="gd-timeline__pop" data-anchor={anchor}>
        <div className="gd-timeline__pop-inner">
          <div className="gd-timeline__pop-title">{session.app || '(未授权)'}</div>
          {session.title ? <div className="gd-timeline__pop-sub">{truncate(session.title, 36)}</div> : null}
          <div className="gd-timeline__pop-sub gd-mono">
            {formatClockTime(st)}–{formatClockTime(et)} · {formatDuration(et - st)}
          </div>
          <div className="gd-timeline__pop-actions">
            <button type="button" className="gd-timeline__pop-btn gd-no-drag" disabled={disabled} onClick={onToggleMenu}>
              <CategoryDot category={session.category} />
              改分类
              <IconChevronDown size={12} />
            </button>
            <button type="button" className="gd-timeline__pop-btn gd-timeline__pop-btn--danger gd-no-drag" disabled={disabled} onClick={onDelete}>
              <IconClose size={12} />
              删除
            </button>
          </div>
          {menuOpen ? (
            <div className="gd-timeline__cat-menu">
              {CATEGORY_ORDER.map((c) => (
                <button key={c} type="button" className="gd-timeline__cat-item gd-no-drag" data-active={c === session.category} onClick={() => onPick(c)}>
                  <CategoryDot category={c} />
                  {CATEGORY_META[c].label}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function ManualBlock({
  record,
  leftPct,
  onEdit,
  onDelete,
  disabled,
}: {
  record: ManualRecord;
  leftPct: number;
  onEdit: () => void;
  onDelete: () => void;
  disabled: boolean;
}): JSX.Element {
  const anchor = anchorOf(leftPct);
  const badge = record.source === 'image' ? '🖼' : '✎';
  const fallbackTitle = record.source === 'image' ? '图片识别' : '手动补录';
  return (
    <div className="gd-timeline__block-wrap gd-timeline__block-wrap--manual" style={{ left: `${leftPct}%` }}>
      <span className="gd-timeline__manual-badge">{badge}</span>
      <div className="gd-timeline__bar gd-timeline__bar--manual" style={{ background: CATEGORY_META[record.category].color }} />
      <div className="gd-timeline__pop" data-anchor={anchor}>
        <div className="gd-timeline__pop-inner">
          <div className="gd-timeline__pop-title">
            {badge} {record.title || fallbackTitle}
          </div>
          <div className="gd-timeline__pop-content">{record.content}</div>
          <div className="gd-timeline__pop-sub gd-mono">
            {formatClockTime(record.ts)} · {CATEGORY_META[record.category].label}
          </div>
          <div className="gd-timeline__pop-actions">
            <button type="button" className="gd-timeline__pop-btn gd-no-drag" disabled={disabled} onClick={onEdit}>
              <IconPencil size={12} />
              编辑
            </button>
            <button type="button" className="gd-timeline__pop-btn gd-timeline__pop-btn--danger gd-no-drag" disabled={disabled} onClick={onDelete}>
              <IconClose size={12} />
              删除
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export interface TimelineProps {
  date: string;
  sessions: Session[];
  manualRecords: ManualRecord[];
  permissionDenied: boolean;
  onChanged: () => void;
  onEditRecord: (record: ManualRecord) => void;
}

interface DeleteTarget {
  kind: 'session' | 'manual';
  id: number;
  label: string;
}

export default function Timeline({ date, sessions, manualRecords, permissionDenied, onChanged, onEditRecord }: TimelineProps): JSX.Element {
  const range = computeViewRange(date, sessions, manualRecords);
  const ticks = computeTicks(range);
  const [menuId, setMenuId] = useState<number | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [busy, setBusy] = useState(false);

  const categoriesPresent = Array.from(
    new Set([...sessions.map((s) => s.category), ...manualRecords.map((r) => r.category)]),
  ) as Category[];
  categoriesPresent.sort((a, b) => (CATEGORY_META[a].label > CATEGORY_META[b].label ? 1 : -1));

  const sessionBlocks: SessionBlockData[] = sessions
    .map((s) => {
      const st = clamp(s.startTs, range.dayStart, range.dayEnd);
      const et = clamp(s.endTs, range.dayStart, range.dayEnd);
      const leftPct = fractionOfDay(st, range.viewStart, range.viewEnd) * 100;
      const rightPct = fractionOfDay(et, range.viewStart, range.viewEnd) * 100;
      const widthPct = Math.max(0, rightPct - leftPct);
      return { session: s, leftPct, widthPct, st, et };
    })
    .filter((b) => b.widthPct > 0 || (b.et > b.st && b.leftPct < 100));

  const manualBlocks = manualRecords
    .filter((r) => r.ts >= range.dayStart && r.ts < range.dayEnd)
    .map((r) => ({ record: r, leftPct: fractionOfDay(clamp(r.ts, range.dayStart, range.dayEnd), range.viewStart, range.viewEnd) * 100 }));

  const isEmpty = sessions.length === 0 && manualRecords.length === 0;

  async function changeCategory(id: number, category: Category): Promise<void> {
    setBusy(true);
    try {
      await api.data.updateSessionCategory(id, category);
      setMenuId(null);
      onChanged();
    } catch {
      // 忽略：主进程未就绪
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelete(): Promise<void> {
    if (!deleteTarget) return;
    setBusy(true);
    try {
      if (deleteTarget.kind === 'session') await api.data.deleteSession(deleteTarget.id);
      else await api.data.deleteManualRecord(deleteTarget.id);
      setDeleteTarget(null);
      onChanged();
    } catch {
      // 忽略
    } finally {
      setBusy(false);
    }
  }

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
      {isEmpty ? (
        <EmptyState icon={<IllustrationTea />} text="还没有记录。保持这个窗口之外的任何工作，拾光会安静地记下来。" />
      ) : (
        <div className="gd-timeline__track-wrap">
          <div className="gd-timeline__track">
            {sessionBlocks.map((block) => (
              <SessionBlock
                key={`s-${block.session.id}`}
                block={block}
                menuOpen={menuId === block.session.id}
                disabled={busy}
                onToggleMenu={() => setMenuId((prev) => (prev === block.session.id ? null : block.session.id))}
                onPick={(c) => void changeCategory(block.session.id, c)}
                onDelete={() => setDeleteTarget({ kind: 'session', id: block.session.id, label: block.session.app || '这段记录' })}
              />
            ))}
            {manualBlocks.map(({ record, leftPct }) => (
              <ManualBlock
                key={`m-${record.id}`}
                record={record}
                leftPct={leftPct}
                disabled={busy}
                onEdit={() => onEditRecord(record)}
                onDelete={() => setDeleteTarget({ kind: 'manual', id: record.id, label: record.title || '这条补录' })}
              />
            ))}
          </div>
          <div className="gd-timeline__ticks">
            {ticks.map((t) => (
              <span className="gd-timeline__tick gd-mono" key={t} style={{ left: `${fractionOfDay(t, range.viewStart, range.viewEnd) * 100}%` }}>
                {formatClockTime(t)}
              </span>
            ))}
          </div>
        </div>
      )}

      <Modal
        open={!!deleteTarget}
        title={deleteTarget?.kind === 'manual' ? '删除这条补录？' : '删除这段记录？'}
        body={`「${deleteTarget?.label ?? ''}」将从时间线移除，此操作不可恢复。`}
        confirmLabel="删除"
        danger
        confirmLoading={busy}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setDeleteTarget(null)}
      />
    </Card>
  );
}
