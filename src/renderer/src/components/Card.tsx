// 卡片（DESIGN §2）：surface + border + shadow-card，标题行左 serif 标题、右可放 ghost 操作。
import type { CSSProperties, JSX, ReactNode } from 'react';
import './Card.css';

export interface CardProps {
  title?: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
  flush?: boolean;
  style?: CSSProperties;
  className?: string;
}

export default function Card({ title, subtitle, action, children, flush = false, style, className }: CardProps): JSX.Element {
  return (
    <div className={['gd-card', flush ? 'gd-card--flush' : '', className ?? ''].filter(Boolean).join(' ')} style={style}>
      {title ? (
        <div className="gd-card__head">
          <div>
            <h3 className="gd-card__title">{title}</h3>
            {subtitle ? <div className="gd-card__subtitle">{subtitle}</div> : null}
          </div>
          {action ? <div>{action}</div> : null}
        </div>
      ) : null}
      {children}
    </div>
  );
}
