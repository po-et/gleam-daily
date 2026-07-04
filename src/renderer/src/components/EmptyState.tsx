// 空态（DESIGN §2）：居中手绘感线条 SVG + 温和文案 + 可选 primary CTA。
import type { JSX, ReactNode } from 'react';
import { IllustrationPaper } from './icons';
import './EmptyState.css';

export interface EmptyStateProps {
  icon?: ReactNode;
  text: ReactNode;
  action?: ReactNode;
}

export default function EmptyState({ icon, text, action }: EmptyStateProps): JSX.Element {
  return (
    <div className="gd-empty">
      <div className="gd-empty__icon">{icon ?? <IllustrationPaper />}</div>
      <div className="gd-empty__text">{text}</div>
      {action}
    </div>
  );
}
