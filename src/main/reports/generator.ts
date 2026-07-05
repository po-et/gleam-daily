// 生成编排：collect -> prompt -> provider.chat -> 存库，进度事件。见 docs/SPEC.md §10。
import { BrowserWindow } from 'electron';
import { IPC_CHANNELS } from '../../shared/ipc-channels';
import type { ReportGenOptions, ReportProgress, Settings } from '../../shared/types';
import type { AiProvider } from '../ai';
import { getProvider, humanizeProviderError } from '../ai';
import { insertReport } from '../db';
import { getSettings } from '../settings';
import type { ReportMaterial } from './collect';
import { collectMaterial } from './collect';
import { buildExtractPrompt, buildReportPrompt } from './prompts';

let inFlight = false;

function broadcastProgress(progress: ReportProgress): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(IPC_CHANNELS.reports.progressEvent, progress);
  }
}

function resolveModelLabel(settings: Settings): string {
  switch (settings.ai.provider) {
    case 'claude-cli':
      return `claude-cli:${settings.ai.claudeCli.model}`;
    case 'anthropic':
      return settings.ai.anthropic.model;
    case 'openai-compat':
      return settings.ai.openaiCompat.model || '(未配置模型)';
    default:
      return settings.ai.provider;
  }
}

export function isReportGenerationInFlight(): boolean {
  return inFlight;
}

/**
 * B4 两段式成稿（SPEC §18.B4，仅 daily × rich）：
 * 1) 第一段 chat 提取工作项清单；2) 清单 + 素材 + 详略锚点成稿（要求逐项覆盖）。
 * 第一段异常或空输出 → 清单置空回退单段（buildReportPrompt 不带 checklist），不阻塞主流程。
 * 两段都在 'generating' 阶段内，不额外发进度事件。
 */
async function generateRichTwoStage(
  provider: AiProvider,
  opts: ReportGenOptions,
  material: ReportMaterial,
  roleContext: string,
): Promise<string> {
  let checklist = '';
  try {
    checklist = (await provider.chat(buildExtractPrompt(material))).trim();
  } catch (err) {
    console.warn('[reports] 两段式第一段提取失败，回退单段生成：', err instanceof Error ? err.message : String(err));
    checklist = '';
  }
  const prompt = buildReportPrompt(opts, material, roleContext, 'rich', checklist || undefined);
  return (await provider.chat(prompt)).trim();
}

/**
 * 同一时刻只允许一个生成任务：并发时直接拒绝并 emit error，不排队、不打断已有任务。
 * 结果不通过返回值传递，全部经 `reports:progress` 事件广播（collecting -> generating -> done/error）。
 */
export async function generateReport(opts: ReportGenOptions): Promise<void> {
  if (inFlight) {
    broadcastProgress({ stage: 'error', message: '已有一个生成任务在进行中，请稍候再试。' });
    return;
  }
  inFlight = true;
  try {
    broadcastProgress({ stage: 'collecting' });
    const settings = getSettings();
    // detail 缺省取 settings.report.defaultDetail（SPEC §18.B3）。
    const detail = opts.detail ?? settings.report.defaultDetail;
    const material = await collectMaterial(opts);

    broadcastProgress({ stage: 'generating' });
    const provider = getProvider(settings);
    // 仅 daily × rich 走 B4 两段式；weekly/monthly 与非 rich 均走原单段路径。
    const contentMd =
      opts.type === 'daily' && detail === 'rich'
        ? await generateRichTwoStage(provider, opts, material, settings.ai.roleContext)
        : (await provider.chat(buildReportPrompt(opts, material, settings.ai.roleContext, detail))).trim();
    if (!contentMd) throw new Error('AI 返回内容为空，请稍后重试。');

    const report = insertReport({
      type: opts.type,
      template: opts.template,
      periodStart: material.periodStart,
      periodEnd: material.periodEnd,
      contentMd,
      model: resolveModelLabel(settings),
      createdTs: Date.now(),
    });

    broadcastProgress({ stage: 'done', reportId: report.id });
  } catch (err) {
    broadcastProgress({ stage: 'error', message: humanizeProviderError(err) });
  } finally {
    inFlight = false;
  }
}
