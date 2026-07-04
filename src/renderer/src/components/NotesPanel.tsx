// 速记面板：今日页右栏用半宽，素材页速记 tab 用全宽版（DESIGN §3/§5）。
// 顶部输入框 Enter 提交 + 下方倒序列表，hover 显删除。
import { useEffect, useState, type JSX } from 'react';
import type { Note } from '@shared/types';
import { api } from '../api';
import { formatClockTime } from '../lib/format';
import Card from './Card';
import Button from './Button';
import { Input } from './FormControls';
import { IconTrash, IllustrationTea } from './icons';
import EmptyState from './EmptyState';
import './NotesPanel.css';

export interface NotesPanelProps {
  startTs: number;
  endTs: number;
  title?: string;
  onNotesChange?: (notes: Note[]) => void;
}

export default function NotesPanel({ startTs, endTs, title = '今日速记', onNotesChange }: NotesPanelProps): JSX.Element {
  const [notes, setNotes] = useState<Note[]>([]);
  const [draft, setDraft] = useState('');
  const [loaded, setLoaded] = useState(false);

  async function load(): Promise<void> {
    try {
      const list = await api.data.listNotes(startTs, endTs);
      setNotes(list);
      onNotesChange?.(list);
    } catch {
      setNotes([]);
    } finally {
      setLoaded(true);
    }
  }

  useEffect(() => {
    setLoaded(false);
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startTs, endTs]);

  async function submit(): Promise<void> {
    const content = draft.trim();
    if (!content) return;
    setDraft('');
    try {
      await api.data.addNote(content);
      await load();
    } catch {
      // ignore：main 尚未实现时不阻塞输入
    }
  }

  async function remove(id: number): Promise<void> {
    setNotes((prev) => prev.filter((n) => n.id !== id));
    try {
      await api.data.deleteNote(id);
    } catch {
      await load();
    }
  }

  const sorted = [...notes].sort((a, b) => b.ts - a.ts);

  return (
    <Card title={title}>
      <div className="gd-notes__input-row">
        <Input
          value={draft}
          placeholder="记一笔，AI 写日报时会参考…"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void submit();
            }
          }}
          style={{ flex: 1 }}
        />
        <Button variant="secondary" onClick={() => void submit()} disabled={!draft.trim()}>
          记下
        </Button>
      </div>
      {loaded && sorted.length === 0 ? (
        <EmptyState icon={<IllustrationTea size={44} />} text="还没有速记，随手记一笔吧。" />
      ) : (
        <div className="gd-notes__list">
          {sorted.map((note) => (
            <div className="gd-notes__item" key={note.id}>
              <span className="gd-notes__time">{formatClockTime(note.ts)}</span>
              <span className="gd-notes__content">{note.content}</span>
              <Button variant="ghost" size="sm" iconOnly className="gd-notes__delete" onClick={() => void remove(note.id)} aria-label="删除">
                <IconTrash size={13} />
              </Button>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
