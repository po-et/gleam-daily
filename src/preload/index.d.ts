// 渲染层类型声明：window.gleam 的类型来自 preload/index.ts 实际暴露的 API 形状，
// 确保契约层只有一份定义来源（preload 实现变了，这里的类型自动跟着变）。
import type { GleamApi } from './index';

declare global {
  interface Window {
    gleam: GleamApi;
  }
}

export {};
