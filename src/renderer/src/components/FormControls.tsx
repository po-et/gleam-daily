// 基础表单控件 + 设置页行样式 + 标签编辑器。DESIGN §2/§6 通用交互。
import { useState, type CSSProperties, type InputHTMLAttributes, type JSX, type KeyboardEvent, type ReactNode, type TextareaHTMLAttributes } from 'react';
import { IconClose, IconPlus } from './icons';
import Button from './Button';
import './FormControls.css';

export function Input({ mono = false, className, ...rest }: InputHTMLAttributes<HTMLInputElement> & { mono?: boolean }): JSX.Element {
  return <input className={['gd-input gd-no-drag', mono ? 'gd-input--mono' : '', className ?? ''].filter(Boolean).join(' ')} {...rest} />;
}

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>): JSX.Element {
  return <textarea className={['gd-textarea gd-no-drag', className ?? ''].filter(Boolean).join(' ')} {...rest} />;
}

export interface SelectOption<T extends string> {
  value: T;
  label: string;
}

export interface SelectProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  options: SelectOption<T>[];
  disabled?: boolean;
  className?: string;
  style?: CSSProperties;
}

export function Select<T extends string>({ value, onChange, options, disabled, className, style }: SelectProps<T>): JSX.Element {
  return (
    <select
      className={['gd-select gd-no-drag', className ?? ''].filter(Boolean).join(' ')}
      style={style}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value as T)}
    >
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}

export interface FieldRowProps {
  label: ReactNode;
  desc?: ReactNode;
  dangerDesc?: boolean;
  children?: ReactNode;
}

export function FieldRow({ label, desc, dangerDesc = false, children }: FieldRowProps): JSX.Element {
  return (
    <div className="gd-field-row">
      <div>
        <div className="gd-field-row__label">{label}</div>
        {desc ? <div className={['gd-field-row__desc', dangerDesc ? 'gd-field-row__desc--danger' : ''].filter(Boolean).join(' ')}>{desc}</div> : null}
      </div>
      <div className="gd-field-row__control">{children}</div>
    </div>
  );
}

export interface TagInputProps {
  values: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
}

/** 标签列表 + 输入添加（排除应用、扫描目录等场景）。 */
export function TagInput({ values, onChange, placeholder }: TagInputProps): JSX.Element {
  const [draft, setDraft] = useState('');

  function commit(): void {
    const v = draft.trim();
    if (v && !values.includes(v)) {
      onChange([...values, v]);
    }
    setDraft('');
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>): void {
    if (e.key === 'Enter') {
      e.preventDefault();
      commit();
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-end' }}>
      <div className="gd-tag-list">
        {values.map((v) => (
          <span className="gd-tag" key={v}>
            {v}
            <button type="button" className="gd-tag__remove gd-no-drag" onClick={() => onChange(values.filter((x) => x !== v))} aria-label={`移除 ${v}`}>
              <IconClose size={11} />
            </button>
          </span>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <Input
          value={draft}
          placeholder={placeholder}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          style={{ width: 180 }}
        />
        <Button size="sm" variant="secondary" onClick={commit} disabled={!draft.trim()}>
          <IconPlus size={13} />
          添加
        </Button>
      </div>
    </div>
  );
}
