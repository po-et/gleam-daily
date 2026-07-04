// 开关（DESIGN §2）：36x21 胶囊，开=accent，关=border-strong。
import type { JSX } from 'react';
import './Switch.css';

export interface SwitchProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  ariaLabel?: string;
}

export default function Switch({ checked, onChange, disabled = false, ariaLabel }: SwitchProps): JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      className="gd-switch gd-no-drag"
      data-on={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span className="gd-switch__dot" />
    </button>
  );
}
