// 全局 Toast（DESIGN §2）：右上角滑入，surface 卡片样式，3s 自动消失。
// 用法：<ToastProvider> 包裹应用根，页面内 const { showToast } = useToast()。
import { createContext, useCallback, useContext, useMemo, useRef, useState, type JSX, type ReactNode } from 'react';
import './Toast.css';

export type ToastVariant = 'default' | 'success' | 'error';

interface ToastItem {
  id: number;
  message: string;
  variant: ToastVariant;
}

interface ToastContextValue {
  showToast: (message: string, variant?: ToastVariant) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    // 兜底：极端情况下（组件树外调用）静默降级为 console，不让页面崩掉。
    return { showToast: (message) => console.warn('[toast:no-provider]', message) };
  }
  return ctx;
}

export function ToastProvider({ children }: { children: ReactNode }): JSX.Element {
  const [items, setItems] = useState<ToastItem[]>([]);
  const idRef = useRef(0);

  const showToast = useCallback((message: string, variant: ToastVariant = 'default') => {
    const id = ++idRef.current;
    setItems((prev) => [...prev, { id, message, variant }]);
    window.setTimeout(() => {
      setItems((prev) => prev.filter((item) => item.id !== id));
    }, 3000);
  }, []);

  const value = useMemo(() => ({ showToast }), [showToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="gd-toast-stack">
        {items.map((item) => (
          <div key={item.id} className={`gd-toast gd-toast--${item.variant}`}>
            <span className="gd-toast__dot" />
            <span>{item.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
