// 极简 Markdown 渲染封装（唯一允许引入的第三方库：marked，见 SPEC §1）。
import { marked } from 'marked';

marked.setOptions({ breaks: true, gfm: true });

/** 同步渲染 Markdown -> HTML 字符串。marked 默认扩展下 parse 是同步的，这里做类型兜底。 */
export function renderMarkdown(md: string): string {
  const result = marked.parse(md ?? '', { async: false });
  return typeof result === 'string' ? result : '';
}
