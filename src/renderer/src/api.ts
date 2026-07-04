// window.gleam 的类型化引用。渲染层其余代码统一从这里 import { api }，不要直接摸 window.gleam。
// 类型来自 preload/index.d.ts 的全局声明（唯一真源），这里不重复定义任何契约类型。
export const api = window.gleam;
