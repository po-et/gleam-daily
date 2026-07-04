// 补录 Modal（DESIGN §10）：时间（date+time）/ 分类（8 选一）/ 标题（可选）/ 内容（必填）。
// 同一组件承担「新建补录」与「编辑已有手动记录」两种模式（传 initial 即编辑）。
import { useEffect, useState, type JSX } from 'react';
import type { Category, ManualRecord } from '@shared/types';
import { CATEGORY_META } from '@shared/categories';
import { api } from '../../api';
import { formatClockTime, formatDateKey } from '../../lib/format';
import { CategoryDot } from '../../components/CategoryDot';
import { Input, Textarea } from '../../components/FormControls';
import Button from '../../components/Button';
import './BackfillModal.css';

const CATEGORY_ORDER: Category[] = ['dev', 'meeting', 'comm', 'docs', 'design', 'research', 'leisure', 'other'];

export interface BackfillModalProps {
  open: boolean;
  /** 传入即编辑模式；不传为新建。 */
  initial?: ManualRecord | null;
  onClose: () => void;
  /** 提交成功后触发（用于刷新时间线）。 */
  onSubmitted: () => void;
}

function tsToDate(ts: number): string {
  return formatDateKey(new Date(ts));
}

export default function BackfillModal({ open, initial, onClose, onSubmitted }: BackfillModalProps): JSX.Element | null {
  const editing = !!initial;
  const [dateStr, setDateStr] = useState('');
  const [timeStr, setTimeStr] = useState('');
  const [category, setCategory] = useState<Category>('other');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    const base = initial ? initial.ts : Date.now();
    setDateStr(tsToDate(base));
    setTimeStr(formatClockTime(base));
    setCategory(initial?.category ?? 'other');
    setTitle(initial?.title ?? '');
    setContent(initial?.content ?? '');
    setSaving(false);
  }, [open, initial]);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  function composeTs(): number {
    const [y, m, d] = dateStr.split('-').map((x) => Number(x));
    const [hh, mm] = timeStr.split(':').map((x) => Number(x));
    const date = new Date(y || 1970, (m || 1) - 1, d || 1, hh || 0, mm || 0, 0, 0);
    const value = date.getTime();
    return Number.isFinite(value) ? value : Date.now();
  }

  async function submit(): Promise<void> {
    const body = content.trim();
    if (!body) return;
    setSaving(true);
    try {
      const ts = composeTs();
      if (initial) {
        await api.data.updateManualRecord(initial.id, { ts, category, title: title.trim(), content: body });
      } else {
        await api.data.addManualRecord({ ts, category, title: title.trim(), content: body, source: 'manual' });
      }
      onSubmitted();
      onClose();
    } catch {
      // 主进程未就绪时静默失败，避免弹层卡死。
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="gd-modal-overlay gd-no-drag"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="gd-backfill-modal" role="dialog" aria-modal="true">
        <h3 className="gd-backfill-modal__title">{editing ? '编辑记录' : '补录一条'}</h3>

        <div className="gd-backfill-modal__field">
          <span className="gd-backfill-modal__label">时间</span>
          <div className="gd-backfill-modal__time">
            <Input type="date" value={dateStr} onChange={(e) => setDateStr(e.target.value)} />
            <Input type="time" value={timeStr} onChange={(e) => setTimeStr(e.target.value)} />
          </div>
        </div>

        <div className="gd-backfill-modal__field">
          <span className="gd-backfill-modal__label">分类</span>
          <div className="gd-backfill-modal__cats">
            {CATEGORY_ORDER.map((c) => (
              <button
                key={c}
                type="button"
                className="gd-backfill-modal__cat gd-no-drag"
                data-active={c === category}
                onClick={() => setCategory(c)}
              >
                <CategoryDot category={c} />
                {CATEGORY_META[c].label}
              </button>
            ))}
          </div>
        </div>

        <div className="gd-backfill-modal__field">
          <span className="gd-backfill-modal__label">标题（可选）</span>
          <Input value={title} placeholder="一句话小标题" onChange={(e) => setTitle(e.target.value)} style={{ width: '100%' }} />
        </div>

        <div className="gd-backfill-modal__field">
          <span className="gd-backfill-modal__label">内容</span>
          <Textarea
            rows={3}
            value={content}
            placeholder="补充这段时间在做什么，写日报时会参考…"
            onChange={(e) => setContent(e.target.value)}
            style={{ width: '100%' }}
          />
        </div>

        <div className="gd-backfill-modal__actions">
          <Button variant="secondary" onClick={onClose}>
            取消
          </Button>
          <Button variant="primary" loading={saving} disabled={!content.trim()} onClick={() => void submit()}>
            {editing ? '保存' : '记下'}
          </Button>
        </div>
      </div>
    </div>
  );
}
