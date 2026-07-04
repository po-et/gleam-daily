// 手写内联 SVG 图标集（DESIGN §2：stroke 1.5px，无填充，手绘感）。
// 禁止引入图标库，全部现画。侧栏导航图标 + 通用小图标 + 空态插画。
import type { JSX, SVGProps } from 'react';

export interface IconProps extends SVGProps<SVGSVGElement> {
  size?: number;
}

function base(size: number): SVGProps<SVGSVGElement> {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.5,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
  };
}

export function IconSun({ size = 16, ...rest }: IconProps): JSX.Element {
  return (
    <svg {...base(size)} {...rest}>
      <circle cx="12" cy="12" r="4.2" />
      <path d="M12 2.5v2.6M12 18.9v2.6M4.2 4.2l1.85 1.85M17.95 17.95l1.85 1.85M2.5 12h2.6M18.9 12h2.6M4.2 19.8l1.85-1.85M17.95 6.05l1.85-1.85" />
    </svg>
  );
}

export function IconPaper({ size = 16, ...rest }: IconProps): JSX.Element {
  return (
    <svg {...base(size)} {...rest}>
      <path d="M6 3h8l4 4v14H6z" />
      <path d="M14 3v4h4" />
      <path d="M8.5 12.5h7M8.5 15.5h7M8.5 9.5h3" />
    </svg>
  );
}

export function IconLayers({ size = 16, ...rest }: IconProps): JSX.Element {
  return (
    <svg {...base(size)} {...rest}>
      <path d="M12 3.5 3.5 8 12 12.5 20.5 8z" />
      <path d="M3.5 12l8.5 4.5L20.5 12" />
      <path d="M3.5 16l8.5 4.5L20.5 16" />
    </svg>
  );
}

export function IconSlider({ size = 16, ...rest }: IconProps): JSX.Element {
  return (
    <svg {...base(size)} {...rest}>
      <path d="M4 6h9M17 6h3M4 12h3M9 12h11M4 18h13M20 18h0.01" />
      <circle cx="13" cy="6" r="2" />
      <circle cx="6.5" cy="12" r="2" />
      <circle cx="17" cy="18" r="2" />
    </svg>
  );
}

export function IconChevronLeft({ size = 16, ...rest }: IconProps): JSX.Element {
  return (
    <svg {...base(size)} {...rest}>
      <path d="M14.5 5.5 8 12l6.5 6.5" />
    </svg>
  );
}

export function IconChevronRight({ size = 16, ...rest }: IconProps): JSX.Element {
  return (
    <svg {...base(size)} {...rest}>
      <path d="M9.5 5.5 16 12l-6.5 6.5" />
    </svg>
  );
}

export function IconChevronDown({ size = 16, ...rest }: IconProps): JSX.Element {
  return (
    <svg {...base(size)} {...rest}>
      <path d="M5.5 9.5 12 16l6.5-6.5" />
    </svg>
  );
}

export function IconTrash({ size = 16, ...rest }: IconProps): JSX.Element {
  return (
    <svg {...base(size)} {...rest}>
      <path d="M4.5 7h15M9.5 7V5a1.5 1.5 0 0 1 1.5-1.5h2A1.5 1.5 0 0 1 14.5 5v2M6.5 7l1 12.5A1.5 1.5 0 0 0 9 20.9h6a1.5 1.5 0 0 0 1.5-1.4L17.5 7" />
      <path d="M10.2 11v6M13.8 11v6" />
    </svg>
  );
}

export function IconPlus({ size = 16, ...rest }: IconProps): JSX.Element {
  return (
    <svg {...base(size)} {...rest}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function IconClose({ size = 16, ...rest }: IconProps): JSX.Element {
  return (
    <svg {...base(size)} {...rest}>
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}

export function IconRefresh({ size = 16, ...rest }: IconProps): JSX.Element {
  return (
    <svg {...base(size)} {...rest}>
      <path d="M4.5 12a7.5 7.5 0 0 1 12.7-5.4M19.5 12a7.5 7.5 0 0 1-12.7 5.4" />
      <path d="M17.2 3.5v3.5h-3.5M6.8 20.5V17h3.5" />
    </svg>
  );
}

export function IconCopy({ size = 16, ...rest }: IconProps): JSX.Element {
  return (
    <svg {...base(size)} {...rest}>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M6 15H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

export function IconDownload({ size = 16, ...rest }: IconProps): JSX.Element {
  return (
    <svg {...base(size)} {...rest}>
      <path d="M12 3.5v11M7.5 10l4.5 4.5L16.5 10" />
      <path d="M4.5 17.5v2A1.5 1.5 0 0 0 6 21h12a1.5 1.5 0 0 0 1.5-1.5v-2" />
    </svg>
  );
}

export function IconExternalLink({ size = 16, ...rest }: IconProps): JSX.Element {
  return (
    <svg {...base(size)} {...rest}>
      <path d="M9 6H5.5A1.5 1.5 0 0 0 4 7.5v11A1.5 1.5 0 0 0 5.5 20h11a1.5 1.5 0 0 0 1.5-1.5V15" />
      <path d="M13 4h7v7M20 4l-9.5 9.5" />
    </svg>
  );
}

export function IconCheck({ size = 16, ...rest }: IconProps): JSX.Element {
  return (
    <svg {...base(size)} {...rest}>
      <path d="M5 12.5 9.5 17 19 6.5" />
    </svg>
  );
}

export function IconSpinner({ size = 16, className, ...rest }: IconProps): JSX.Element {
  return (
    <svg
      {...base(size)}
      className={['gd-spin', className].filter(Boolean).join(' ')}
      {...rest}
    >
      <path d="M12 3.5a8.5 8.5 0 1 0 8.5 8.5" strokeOpacity={1} />
      <path d="M12 3.5a8.5 8.5 0 0 1 8.5 8.5" strokeOpacity={0.25} />
    </svg>
  );
}

/** 空态插画：一张纸，手绘感极简线条。 */
export function IllustrationPaper({ size = 56, ...rest }: IconProps): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" {...rest}>
      <path d="M18 8h20l8 9v37a2 2 0 0 1-2 2H18a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2z" />
      <path d="M38 8v9h8" />
      <path d="M23 30h18M23 37h18M23 44h11" />
    </svg>
  );
}

/** 空态插画：一杯茶，手绘感极简线条。 */
export function IllustrationTea({ size = 56, ...rest }: IconProps): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" {...rest}>
      <path d="M14 28h30v10a12 12 0 0 1-12 12H26a12 12 0 0 1-12-12z" />
      <path d="M44 31h4a6 6 0 0 1 0 12h-3" />
      <path d="M22 10c-2 3 2 4 0 7M31 10c-2 3 2 4 0 7" />
      <path d="M12 56h34" />
    </svg>
  );
}

/** 空态插画：图层松散排列，用于素材页各 tab 的空数据展示。 */
export function IllustrationLayers({ size = 56, ...rest }: IconProps): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" {...rest}>
      <path d="M32 8 12 19l20 11 20-11z" />
      <path d="M12 30l20 11 20-11" />
      <path d="M12 41l20 11 20-11" />
    </svg>
  );
}
