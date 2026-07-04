// 胶囊分段控件：类型/模板/主题三选一等场景通用。
import type { JSX } from 'react';
import './SegmentControl.css';

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
}

export interface SegmentControlProps<T extends string> {
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  block?: boolean;
}

export default function SegmentControl<T extends string>({ options, value, onChange, block = false }: SegmentControlProps<T>): JSX.Element {
  return (
    <div className={['gd-segment gd-no-drag', block ? 'gd-segment--block' : ''].filter(Boolean).join(' ')} role="tablist">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          role="tab"
          className="gd-segment__item"
          data-active={opt.value === value}
          aria-selected={opt.value === value}
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
