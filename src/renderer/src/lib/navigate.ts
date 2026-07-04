// 页面间跳转辅助：今日页「生成今日日报」CTA 需要跳到报告页并自动触发生成。
//
// 两条路径都做（任务要求），保证健壮：
// 1) hash 查询参数兜底 `#/reports?autoGenerate=1&date=...`——由本文件写入 hash，Reports 页解析，可靠、始终可用。
// 2) 主进程可能通过 preload 暴露一个尚未在契约里出现的 `app.onNavigate` 事件（例如托盘菜单“生成今日日报”）。
//    由于 preload/shared 不归本层所有，这里只做运行时特性探测，不假设该 API 一定存在；
//    存在就订阅，不存在就什么都不做，不会影响 typecheck 或运行时。
import { api } from '../api';

export interface NavigatePayload {
  page: string;
  autoGenerate?: boolean;
  date?: string;
}

export function goToReportsAutoGenerate(dateStr: string): void {
  const params = new URLSearchParams({ autoGenerate: '1', date: dateStr });
  window.location.hash = `#/reports?${params.toString()}`;
}

/** 解析当前 hash 中 `?` 之后的查询串。形如 "#/reports?autoGenerate=1&date=2026-07-04"。 */
export function parseHashQuery(hash: string): URLSearchParams {
  const qIndex = hash.indexOf('?');
  return new URLSearchParams(qIndex >= 0 ? hash.slice(qIndex + 1) : '');
}

/** 去掉 hash 中的查询参数，只留 "#/reports" 这类纯路径，避免重复触发。 */
export function stripHashQuery(hash: string): string {
  const qIndex = hash.indexOf('?');
  return qIndex >= 0 ? hash.slice(0, qIndex) : hash;
}

type NavigateApi = { onNavigate?: (cb: (payload: NavigatePayload) => void) => () => void };

/** 特性探测：若 preload 未来扩展了 app.onNavigate，直接可用；否则安全地什么都不做。 */
export function subscribeAppNavigate(cb: (payload: NavigatePayload) => void): () => void {
  const appApi = api.app as unknown as NavigateApi;
  if (typeof appApi.onNavigate === 'function') {
    return appApi.onNavigate(cb);
  }
  return () => {};
}
