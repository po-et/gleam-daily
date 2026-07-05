// 四种模板的 prompt 构建。逐字对应 docs/SPEC.md §10 的结构要求（模板要求段落原文照抄）。
// system prompt（"你是一位严谨的工作汇报助手"）由各 ai/ Provider 自己在调用底层 API 时设置，
// 这里只负责拼这条 user message。
import type { ReportDetailLevel, ReportGenOptions, ReportTemplate, ReportType } from '../../shared/types';
import { getMeta } from '../db';
import { getSettings } from '../settings';
import type { ReportMaterial } from './collect';

const TYPE_LABEL: Record<ReportType, string> = { daily: '日报', weekly: '周报', monthly: '月报' };

// 记忆注入截断上限（SPEC §17.A：注入时截断到 2000 字符）。
const MEMORY_INJECT_LIMIT = 2000;

/**
 * 把工作记忆内容包装成注入块（SPEC §17.A）。空记忆返回 ''。
 * vision：识别时优先使用；reports：撰写报告时优先使用。文案逐字对齐 SPEC。
 * 该函数为纯函数，供报告 prompt（本文件）与截图分析（memory.ts → screenshots.ts）复用，避免重复模板文案。
 */
export function formatMemoryBlock(memoryContent: string, target: 'vision' | 'reports'): string {
  const trimmed = memoryContent.trim();
  if (!trimmed) return '';
  const truncated = trimmed.length > MEMORY_INJECT_LIMIT ? trimmed.slice(0, MEMORY_INJECT_LIMIT) : trimmed;
  const usage = target === 'vision' ? '识别时优先使用其中的标准名称' : '撰写报告时优先使用其中的标准名称';
  return `【用户工作记忆，${usage}】\n${truncated}\n---\n`;
}

// buildMemoryPrompt 的“系统指令”部分。由于 AiProvider.chat 只接受单条 user message（system 由 provider 固定），
// 这里把 SPEC §17.A 的 system 文案逐字拼到 user prompt 顶部。
const MEMORY_SYSTEM_INSTRUCTION = `你是个人工作记忆整理助手。基于用户的工作记录素材，整理一份简洁的个人工作画像，供后续 AI 识别屏幕内容和撰写日报时参考。输出 Markdown，仅包含以下小节（无内容的小节省略）：## 项目与产品（标准名称，括号内列常见别名/误写）、## 技术栈与工具、## 常用协作对象、## 工作习惯、## 术语对照。全文不超过 500 字。只能基于素材归纳，禁止虚构。直接输出 Markdown，不要解释。`;

/** 记忆刷新 prompt（SPEC §17.A）。existingMemory 非空时标注「已有记忆，请在其基础上增量更新」。 */
export function buildMemoryPrompt(material: string, existingMemory: string): string {
  const lines: string[] = [];
  lines.push(MEMORY_SYSTEM_INSTRUCTION);
  lines.push('');
  const existing = existingMemory.trim();
  if (existing) {
    lines.push('【已有记忆，请在其基础上增量更新】');
    lines.push(existing);
    lines.push('');
  }
  lines.push('【工作记录素材】');
  lines.push(material.trim() || '（近 30 天暂无可用素材）');
  return lines.join('\n');
}

function templateRequirement(template: ReportTemplate): string {
  switch (template) {
    case 'standard':
      return '结构：## 今日概览（2-3句）/ ## 主要工作（按事项分点，写清做了什么、进展如何）/ ## 数据速览（专注时长、主要投入方向，1-2行）/ ## 明日计划（基于未完成事项合理推断，谨慎、可标注"待定"）。输出必须以"## 今日概览"这一行开头，四个二级标题一个都不能省略。';
    case 'concise':
      return '总长不超过 200 字，3-6 个要点，直接列点，无标题。';
    case 'technical':
      return '按项目/仓库组织；引用具体 commit 信息与文件变更规模；技术决策与遇到的问题单独成节。';
    case 'okr':
      return '结构：## 本期进展（按目标/方向归组）/ ## 关键结果与量化数据 / ## 风险与阻塞 / ## 下期计划';
  }
}

/** v1.4 详略锚点（SPEC §18.B3）。与模板正交：模板管结构，详略管展开度。 */
function detailRequirement(detail: ReportDetailLevel): string {
  switch (detail) {
    case 'concise':
      return '全文 200-350 字，只保留当天最重要的 3-5 件事，点到为止、不铺开细节。';
    case 'standard':
      return '全文 350-600 字，按标准篇幅展开各事项，做了什么、进展如何写清楚。';
    case 'rich':
      return '每个工作项展开 2-4 句（背景 / 做了什么 / 进展或结果），必须引用素材中的具体名词与数字（文件名、页面、时长、提交规模等）；全文 600-1200 字，小节内用列表逐项呈现；严禁出现"进行了多项工作""完成了相关任务"这类空泛概括句。';
  }
}

function describePeriod(type: ReportType, start: string, end: string): string {
  if (type === 'daily') return start;
  if (type === 'weekly') return `${start} 至 ${end} 这一周`;
  const [year, month] = start.split('-');
  return `${year} 年 ${Number(month)} 月`;
}

/** 素材数据小节（<时间统计> 置顶，其后为时间线/屏幕/Git/速记/补录）。供成稿与提取两种 prompt 复用。 */
function materialDataLines(material: ReportMaterial): string[] {
  return [
    '<时间统计>',
    material.statsText,
    '<时间线摘要>',
    material.timelineText,
    '<屏幕活动分析>',
    material.screenshotsText,
    '<Git 提交>',
    material.commitsText,
    '<手动速记>',
    material.notesText,
    '<手动补录>',
    material.manualRecordsText,
  ];
}

/**
 * 成稿 prompt。detail 由调用方（generator）解析后传入（缺省取 settings.report.defaultDetail）。
 * extractedChecklist 仅在 B4 两段式第二段传入：要求逐项覆盖、不得丢项。
 */
export function buildReportPrompt(
  opts: ReportGenOptions,
  material: ReportMaterial,
  roleContext: string,
  detail: ReportDetailLevel,
  extractedChecklist?: string,
): string {
  const periodLabel = describePeriod(opts.type, material.periodStart, material.periodEnd);
  const typeLabel = TYPE_LABEL[opts.type];

  const lines: string[] = [];
  lines.push(`【任务】基于以下客观工作记录，撰写 ${periodLabel} 的${typeLabel}。`);
  if (roleContext.trim()) {
    lines.push(`【我的角色】${roleContext.trim()}`);
  }
  lines.push('【写作要求】');
  lines.push('- 只依据给定数据，禁止编造未出现的工作内容；数据稀疏时如实写简短版本。');
  lines.push('- 中文输出，Markdown 格式，不要代码块包裹，不要出现"以下是"之类的引导语。');
  lines.push('- 报告中出现的时长与数字必须来自下方 <时间统计> 小节，禁止编造或估算。');
  lines.push('- 时长数据仅作参考，不必逐条罗列时间。');
  lines.push(`- ${templateRequirement(opts.template)}`);
  lines.push(`- 详略要求：${detailRequirement(detail)}`);
  const checklist = extractedChecklist?.trim();
  if (checklist) {
    lines.push('- 必须逐项覆盖下方【工作项清单】中的每一项，不得遗漏、不得把多项压缩成一句概括。');
  }
  // 记忆注入（SPEC §17.A）：settings.memory.enabled && injectToReports 且记忆非空时，在素材段之前拼记忆块。
  const settings = getSettings();
  if (settings.memory.enabled && settings.memory.injectToReports) {
    const memoryBlock = formatMemoryBlock(getMeta('memory.content') ?? '', 'reports');
    if (memoryBlock) lines.push(memoryBlock);
  }
  if (checklist) {
    lines.push('【工作项清单（已从素材提取，逐项覆盖）】');
    lines.push(checklist);
  }
  lines.push('【工作记录数据】');
  lines.push(...materialDataLines(material));
  if (opts.extraInstructions?.trim()) {
    lines.push(`【附加要求】${opts.extraInstructions.trim()}`);
  }
  return lines.join('\n');
}

/**
 * B4 两段式第一段（SPEC §18.B4）：从素材提取「工作项清单」，只提取不解读。
 * 仅在 daily × rich 路径由 generator 调用；输出 8-20 项，每行一项。
 */
export function buildExtractPrompt(material: ReportMaterial): string {
  const lines: string[] = [];
  lines.push('【任务】从下方客观工作记录中提取一份"工作项清单"，供随后撰写详尽日报使用。');
  lines.push('【要求】');
  lines.push('- 逐条列出当天发生的独立工作项，每行一项，格式：`- [分类] 一句话概述 + 关键名词`。');
  lines.push('- 关键名词指素材中出现的项目名 / 文档名 / 页面标题 / 代码文件名 / 仓库名 / 提交信息等专有名词，尽量原样保留。');
  lines.push('- 共提取 8-20 项；只做客观提取，不解读、不评价、不合并为概括句。');
  lines.push('- 直接输出清单本体，不要任何标题、开场白或结语。');
  lines.push('【工作记录数据】');
  lines.push(...materialDataLines(material));
  return lines.join('\n');
}
