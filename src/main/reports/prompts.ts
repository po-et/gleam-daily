// 四种模板的 prompt 构建。逐字对应 docs/SPEC.md §10 的结构要求（模板要求段落原文照抄）。
// system prompt（"你是一位严谨的工作汇报助手"）由各 ai/ Provider 自己在调用底层 API 时设置，
// 这里只负责拼这条 user message。
import type { ReportGenOptions, ReportTemplate, ReportType } from '../../shared/types';
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

function describePeriod(type: ReportType, start: string, end: string): string {
  if (type === 'daily') return start;
  if (type === 'weekly') return `${start} 至 ${end} 这一周`;
  const [year, month] = start.split('-');
  return `${year} 年 ${Number(month)} 月`;
}

export function buildReportPrompt(opts: ReportGenOptions, material: ReportMaterial, roleContext: string): string {
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
  lines.push('- 时长数据仅作参考，不必逐条罗列时间。');
  lines.push(`- ${templateRequirement(opts.template)}`);
  // 记忆注入（SPEC §17.A）：settings.memory.enabled && injectToReports 且记忆非空时，在素材段之前拼记忆块。
  const settings = getSettings();
  if (settings.memory.enabled && settings.memory.injectToReports) {
    const memoryBlock = formatMemoryBlock(getMeta('memory.content') ?? '', 'reports');
    if (memoryBlock) lines.push(memoryBlock);
  }
  lines.push('【工作记录数据】');
  lines.push('<时间线摘要>');
  lines.push(material.timelineText);
  lines.push('<屏幕活动分析>');
  lines.push(material.screenshotsText);
  lines.push('<Git 提交>');
  lines.push(material.commitsText);
  lines.push('<手动速记>');
  lines.push(material.notesText);
  lines.push('<手动补录>');
  lines.push(material.manualRecordsText);
  if (opts.extraInstructions?.trim()) {
    lines.push(`【附加要求】${opts.extraInstructions.trim()}`);
  }
  return lines.join('\n');
}
