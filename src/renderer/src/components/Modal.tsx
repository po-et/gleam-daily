// 自绘确认弹层（DESIGN §6 清除所有数据 / 通用二次确认）：surface 卡片居中，遮罩 rgba(20,18,15,.4)。
import { useEffect, type JSX, type ReactNode } from 'react';
import Button from './Button';
import './Modal.css';

export interface ModalProps {
  open: boolean;
  title: string;
  body?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  confirmLoading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function Modal({
  open,
  title,
  body,
  confirmLabel = '确定',
  cancelLabel = '取消',
  danger = false,
  confirmLoading = false,
  onConfirm,
  onCancel,
}: ModalProps): JSX.Element | null {
  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div className="gd-modal-overlay gd-no-drag" onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="gd-modal" role="dialog" aria-modal="true">
        <h3 className="gd-modal__title">{title}</h3>
        {body ? <div className="gd-modal__body">{body}</div> : null}
        <div className="gd-modal__actions">
          <Button variant="secondary" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm} loading={confirmLoading}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
