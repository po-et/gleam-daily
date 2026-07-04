// 通用 hooks：轮询、防抖。纯渲染层工具，不碰契约类型。
import { useEffect, useRef, useState } from 'react';

/** 每 delayMs 调用一次 callback（首次不会立即执行，由调用方自行决定是否 mount 时先调一次）。 */
export function useInterval(callback: () => void, delayMs: number | null): void {
  const savedCallback = useRef(callback);
  savedCallback.current = callback;

  useEffect(() => {
    if (delayMs === null) return undefined;
    const id = window.setInterval(() => savedCallback.current(), delayMs);
    return () => window.clearInterval(id);
  }, [delayMs]);
}

/** 防抖后的值：value 变化后等待 delayMs 静默期才更新返回值。 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}
