// 通用 hover 浮层提示（DESIGN §2）。时间线 session 块的富文本 tooltip 需要贴合绝对定位轨道、
// 有边界感知，逻辑更特殊，在 Timeline 组件内单独实现（复用同一套 .gd-tooltip 视觉样式）。
import { useState, type JSX, type ReactNode } from 'react';
import './Tooltip.css';

export default function Tooltip({ content, children, wrap = false }: { content: ReactNode; children: ReactNode; wrap?: boolean }): JSX.Element {
  const [visible, setVisible] = useState(false);
  return (
    <span
      className="gd-tooltip-wrap"
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
    >
      {children}
      {visible && content ? <span className={['gd-tooltip', wrap ? 'gd-tooltip--wrap' : ''].filter(Boolean).join(' ')}>{content}</span> : null}
    </span>
  );
}
