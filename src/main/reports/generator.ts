// 生成编排：collect -> prompt -> provider.chat -> 存库，进度事件。见 docs/SPEC.md §10。
import { BrowserWindow } from 'electron';
import { IPC_CHANNELS } from '../../shared/ipc-channels';
import type { ReportGenOptions, ReportProgress, Settings } from '../../shared/types';
import { getProvider, humanizeProviderError } from '../ai';
import { insertReport } from '../db';
import { getSettings } from '../settings';
import { collectMaterial } from './collect';
import { buildReportPrompt } from './prompts';

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
    const material = await collectMaterial(opts);
    const prompt = buildReportPrompt(opts, material, settings.ai.roleContext);

    broadcastProgress({ stage: 'generating' });
    const provider = getProvider(settings);
    const contentMd = (await provider.chat(prompt)).trim();
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
