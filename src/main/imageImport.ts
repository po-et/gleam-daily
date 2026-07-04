// v1.3 传图识别（SPEC §17.C）。
// 剪贴板 / 文件 → 临时 png（userData/screenshots/import-*.png）→ 复用截图视觉分析与敏感熔断
// → 成功建 ManualRecord(source 'image') → 无论成败立即删除临时图 → 返回 ImageImportResult。
import fs from 'node:fs';
import path from 'node:path';
import { BrowserWindow, clipboard, dialog, nativeImage } from 'electron';
import type { ImageImportResult } from '../shared/types';
import { humanizeProviderError } from './ai';
import { insertManualRecord } from './db';
import { resolveScreenshotsDir } from './paths';
import { analyzeImagePath } from './screenshots';
import { getMainWindow } from './windows';

function parentWindow(): BrowserWindow | null {
  return BrowserWindow.getFocusedWindow() ?? getMainWindow();
}

/** 拿到 PNG 字节：clipboard 空 → empty-clipboard；file 取消 → cancelled；读不出 → failed。 */
async function acquirePng(source: 'clipboard' | 'file'): Promise<{ ok: true; png: Buffer } | { ok: false; result: ImageImportResult }> {
  if (source === 'clipboard') {
    const img = clipboard.readImage();
    if (img.isEmpty()) {
      return { ok: false, result: { ok: false, reason: 'empty-clipboard', message: '剪贴板中没有图片，请先复制一张图片再试。' } };
    }
    return { ok: true, png: img.toPNG() };
  }

  const win = parentWindow();
  const options: Electron.OpenDialogOptions = {
    properties: ['openFile'],
    filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'] }],
  };
  const dialogResult = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
  if (dialogResult.canceled || dialogResult.filePaths.length === 0) {
    return { ok: false, result: { ok: false, reason: 'cancelled', message: '已取消选择图片。' } };
  }
  const picked = dialogResult.filePaths[0];
  if (!picked) {
    return { ok: false, result: { ok: false, reason: 'cancelled', message: '已取消选择图片。' } };
  }
  try {
    const img = nativeImage.createFromPath(picked);
    if (img.isEmpty()) {
      return { ok: false, result: { ok: false, reason: 'failed', message: '无法读取所选图片文件（格式可能不受支持）。' } };
    }
    return { ok: true, png: img.toPNG() };
  } catch {
    return { ok: false, result: { ok: false, reason: 'failed', message: '无法读取所选图片文件。' } };
  }
}

export async function importImage(source: 'clipboard' | 'file'): Promise<ImageImportResult> {
  const acquired = await acquirePng(source);
  if (!acquired.ok) return acquired.result;

  const tempPath = path.join(resolveScreenshotsDir(), `import-${Date.now()}.png`);
  try {
    fs.writeFileSync(tempPath, acquired.png);
  } catch {
    return { ok: false, reason: 'failed', message: '无法写入临时图片文件。' };
  }

  try {
    const analysis = await analyzeImagePath(tempPath);
    if (analysis.sensitive) {
      return { ok: false, reason: 'sensitive', message: '图片包含敏感信息，已跳过识别且未保存任何内容。' };
    }
    const summary = analysis.summary.trim();
    if (!summary) {
      return { ok: false, reason: 'failed', message: '未能从图片中识别出有效内容，请换一张更清晰的图片。' };
    }
    const record = insertManualRecord({
      ts: Date.now(),
      category: analysis.category ?? 'other',
      title: '',
      content: summary,
      source: 'image',
    });
    return { ok: true, record };
  } catch (err) {
    return { ok: false, reason: 'failed', message: `识别失败：${humanizeProviderError(err)}` };
  } finally {
    // 无论成败立即删除临时图（SPEC §17.C 隐私红线）。
    try {
      fs.unlinkSync(tempPath);
    } catch {
      // 文件可能已不存在，忽略
    }
  }
}
