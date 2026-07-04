// 按钮（DESIGN §2）：primary/secondary/ghost/danger，高 34px，无阴影。
import type { ButtonHTMLAttributes, JSX, ReactNode } from 'react';
import { IconSpinner } from './icons';
import './Button.css';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  variant?: ButtonVariant;
  size?: 'md' | 'sm';
  loading?: boolean;
  full?: boolean;
  iconOnly?: boolean;
  children?: ReactNode;
}

export default function Button({
  variant = 'secondary',
  size = 'md',
  loading = false,
  full = false,
  iconOnly = false,
  className,
  disabled,
  children,
  ...rest
}: ButtonProps): JSX.Element {
  const classes = [
    'gd-btn',
    `gd-btn--${variant}`,
    size === 'sm' ? 'gd-btn--sm' : '',
    full ? 'gd-btn--full' : '',
    iconOnly ? 'gd-btn--icon-only' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button className={classes} disabled={disabled || loading} {...rest}>
      {loading ? <IconSpinner size={14} /> : null}
      {children}
    </button>
  );
}
