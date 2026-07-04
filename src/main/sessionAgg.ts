// 前台采样 -> session 聚合的纯判定核心（见 docs/SPEC.md §7）。
// tracker.ts 的实时采样循环与单元测试都复用这里的规则原语，保证“同一活动判定”“断裂判定”只有一份定义，不会漂移。
import type { Category } from '../shared/types';

/** 新样本是否与当前 session 属于“同一活动”（app + title 完全相同）。不同即需关闭旧 session、新建一条。 */
export function isSameActivity(current: { app: string; title: string } | null, app: string, title: string): boolean {
  return current !== null && current.app === app && current.title === title;
}

/**
 * 相邻两次真正执行的采样 tick 之间是否构成“断裂”（系统睡眠 / 严重卡顿）：间隔超过 3× 采样间隔。
 * 断裂时旧 session 不应被拉伸去覆盖这段空白，需先关闭再处理新样本。
 */
export function isBreakGap(prevTickTs: number | null, nowTs: number, sampleIntervalSec: number): boolean {
  if (prevTickTs === null) return false;
  return nowTs - prevTickTs > 3 * sampleIntervalSec * 1000;
}

// ---------------------------------------------------------------------------
// 供单元测试的参考聚合器：用与 tracker 实时循环完全一致的规则（复用上面的 isSameActivity），
// 把一串事件（采样 / idle / 断裂 / 锁屏）归约成 session 列表。规则单一来源，测的就是线上跑的。
// ---------------------------------------------------------------------------

export interface SampleEvent {
  kind: 'sample';
  app: string;
  title: string;
  category: Category;
  ts: number;
}

/** 关闭当前 session 的控制事件：idle 超阈、断裂、锁屏/睡眠。 */
export interface ControlEvent {
  kind: 'idle' | 'break' | 'lock';
}

export type TrackerEvent = SampleEvent | ControlEvent;

export interface AggregatedSession {
  app: string;
  title: string;
  category: Category;
  startTs: number;
  endTs: number;
}

/**
 * 参考实现：把事件序列按 SPEC §7 的聚合规则归约成 session 列表。
 * - 采样与当前 session 同活动 -> 只推进 endTs；不同 -> 关闭旧的、新建一条。
 * - idle / break / lock 控制事件 -> 关闭当前 session（下一个采样会新建）。
 * tracker.ts 的在线循环与本函数共用 isSameActivity，行为一致。
 */
export function aggregateEvents(events: TrackerEvent[]): AggregatedSession[] {
  const sessions: AggregatedSession[] = [];
  let current: AggregatedSession | null = null;
  for (const ev of events) {
    if (ev.kind !== 'sample') {
      current = null;
      continue;
    }
    if (isSameActivity(current, ev.app, ev.title) && current) {
      current.endTs = ev.ts;
    } else {
      current = { app: ev.app, title: ev.title, category: ev.category, startTs: ev.ts, endTs: ev.ts };
      sessions.push(current);
    }
  }
  return sessions;
}
