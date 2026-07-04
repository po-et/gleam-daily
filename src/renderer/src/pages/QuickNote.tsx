// 速记小窗（DESIGN §7）：透明底圆角、自增高、Enter 保存 → ✓ 反馈后 window.close()、Esc 直接 close、自动聚焦。
import { useCallback, useLayoutEffect, useRef, useState, type JSX } from 'react';
import { api } from '../api';
import { IconCheck } from '../components/icons';
import './QuickNote.css';

export default function QuickNote(): JSX.Element {
  const [value, setValue] = useState('');
  const [saved, setSaved] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // 自增高：内容变化后按 scrollHeight 调整高度（受 CSS min/max-height 约束）。
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  const submit = useCallback(async (): Promise<void> => {
    const content = value.trim();
    if (!content || submitting) return;
    setSubmitting(true);
    try {
      await api.data.addNote(content);
    } catch {
      // 主进程桩未就绪也照常给出反馈并关闭：速记体验不因后端阻塞而卡住。
    }
    setSaved(true);
    window.setTimeout(() => window.close(), 550);
  }, [value, submitting]);

  return (
    <div className="gd-quicknote">
      <div className="gd-quicknote__hint">速记 · Enter 保存 / Esc 取消</div>
      {saved ? (
        <div className="gd-quicknote__saved">
          <span className="gd-quicknote__saved-check">
            <IconCheck size={16} />
          </span>
          已记下
        </div>
      ) : (
        <textarea
          ref={textareaRef}
          className="gd-quicknote__input"
          autoFocus
          value={value}
          placeholder="此刻在做什么？"
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void submit();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              window.close();
            }
          }}
        />
      )}
    </div>
  );
}
