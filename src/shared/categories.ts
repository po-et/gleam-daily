// 分类元数据 + 默认应用/标题分类规则。见 docs/SPEC.md §6。
import type { Category } from './types';

export const CATEGORY_META: Record<Category, { label: string; color: string }> = {
  dev: { label: '开发', color: '#6E8898' },
  meeting: { label: '会议', color: '#D97757' },
  comm: { label: '沟通', color: '#C9A66B' },
  docs: { label: '文档', color: '#7D8F69' },
  design: { label: '设计', color: '#9C7C8C' },
  research: { label: '浏览调研', color: '#93A8BC' },
  leisure: { label: '休息', color: '#9B9A93' },
  other: { label: '其他', color: '#B5B3AB' },
};

/** 默认应用 -> 分类映射规则（子串匹配，大小写不敏感）。 */
const APP_CATEGORY_RULES: { category: Exclude<Category, 'research' | 'other'>; keywords: string[] }[] = [
  {
    category: 'dev',
    keywords: [
      'code', 'cursor', 'intellij', 'pycharm', 'webstorm', 'xcode', 'terminal',
      'iterm', 'warp', 'ghostty', 'sourcetree', 'fork', 'tower', 'datagrip', 'sublime',
    ],
  },
  {
    category: 'meeting',
    keywords: ['腾讯会议', 'zoom', '飞书会议', 'teams', 'facetime'],
  },
  {
    category: 'comm',
    keywords: ['微信', 'wechat', '钉钉', 'dingtalk', '飞书', 'lark', 'slack', 'telegram', 'qq', '大象', 'mail', '邮件'],
  },
  {
    category: 'docs',
    keywords: ['word', 'pages', 'notion', 'obsidian', 'typora', '语雀', '石墨', 'wps', 'textedit', 'craft', 'bear'],
  },
  {
    category: 'design',
    keywords: ['figma', 'sketch', 'photoshop', 'illustrator', 'keynote', 'canva'],
  },
  {
    category: 'leisure',
    keywords: ['网易云音乐', 'music', 'spotify', 'bilibili', 'youtube', '爱奇艺', '腾讯视频', 'steam'],
  },
];

/** 浏览器类应用：命中标题关键词做细分，否则兜底 research。见 SPEC §6 “浏览器细分”。 */
const BROWSER_APPS = ['safari', 'chrome', 'arc', 'edge', 'firefox', 'dia'];

const BROWSER_TITLE_RULES: { category: Category; keywords: string[] }[] = [
  { category: 'dev', keywords: ['github', 'stack overflow', 'localhost', 'mdn', '掘金', 'csdn'] },
  { category: 'docs', keywords: ['飞书文档', 'google docs', '语雀', 'confluence', 'wiki'] },
  { category: 'leisure', keywords: ['bilibili', 'youtube', '爱奇艺', '腾讯视频', 'netflix', '优酷', '芒果tv'] },
];

/**
 * 根据前台应用名 + 窗口标题推断分类。
 * 浏览器类应用：优先按标题命中细分规则，否则记 research。
 * 非浏览器应用：按默认应用映射表子串匹配，均未命中则兜底 other。
 */
export function categorize(app: string, title: string): Category {
  const appLower = app.toLowerCase();
  const titleLower = (title || '').toLowerCase();

  const isBrowser = BROWSER_APPS.some((keyword) => appLower.includes(keyword));
  if (isBrowser) {
    for (const rule of BROWSER_TITLE_RULES) {
      if (rule.keywords.some((k) => titleLower.includes(k.toLowerCase()))) {
        return rule.category;
      }
    }
    return 'research';
  }

  for (const rule of APP_CATEGORY_RULES) {
    if (rule.keywords.some((k) => appLower.includes(k.toLowerCase()))) {
      return rule.category;
    }
  }

  return 'other';
}
