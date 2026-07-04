// 主题应用：settings.theme + matchMedia 双源决定 html[data-theme]（DESIGN §1）。
// - 'light' / 'dark'：显式挂 data-theme 覆盖系统偏好。
// - 'system'：用 matchMedia 解析出当前系统实际的深浅，仍然显式挂 data-theme（解析结果），
//   这样两个来源（用户偏好 + 系统偏好）共同决定最终值；系统偏好变化时由 watchSystemTheme 重新解析。
import type { Settings } from '@shared/types';

type ThemePref = Settings['theme'];

// 记住最近一次用户偏好，供系统偏好变化时（仅在 'system' 模式下）重新解析。
let currentPref: ThemePref = 'system';

const prefersDark = (): boolean =>
  typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches;

/** 结合用户偏好与系统偏好，解析出最终应生效的深浅色。 */
export function resolveTheme(theme: ThemePref): 'light' | 'dark' {
  if (theme === 'light' || theme === 'dark') return theme;
  return prefersDark() ? 'dark' : 'light';
}

export function applyTheme(theme: ThemePref): void {
  currentPref = theme;
  document.documentElement.setAttribute('data-theme', resolveTheme(theme));
}

/** 订阅系统深浅色变化：仅当用户偏好为 'system' 时才跟随系统重新应用。返回取消订阅函数。 */
export function watchSystemTheme(): () => void {
  if (typeof window.matchMedia !== 'function') return () => {};
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const handler = (): void => {
    if (currentPref === 'system') applyTheme('system');
  };
  mq.addEventListener('change', handler);
  return () => mq.removeEventListener('change', handler);
}
