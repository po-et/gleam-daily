// 截图捕获 + AI 分析流水线。见 docs/SPEC.md §8。
// 独立于 tracker 的开关，但复用 tracker 的 idle/排除判断（tracker.shouldSkipCaptureNow）。
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { Category } from '../shared/types';
import { getStaleScreenshots, insertScreenshot, markScreenshotDeleted, updateScreenshotAnalysis } from './db';
import { getProvider, humanizeProviderError } from './ai';
import { resolveScreenshotsDir } from './paths';
import { checkScreenRecordingPermission } from './permissions';
import { getSettings } from './settings';
import { getCurrentForegroundApp, shouldSkipCaptureNow } from './tracker';

const VISION_PROMPT = `请观察这张屏幕截图，只输出一个严格的 JSON 对象（不要 Markdown 代码块、不要任何额外文字），格式如下：
{"summary": "一句话描述用户正在做的具体工作（中文，尽量包含关键实体，如项目名/文档名/网站名）", "category": "dev|meeting|comm|docs|design|research|leisure|other", "sensitive": false}
其中 sensitive 表示画面中是否包含密码输入框、支付/银行信息、聊天中的私人内容、身份证件等敏感信息，命中任一即为 true。`;

const CAPTURE_RETRY_LIMIT = 1; // 分析失败重试 1 次（总计尝试 2 次）
const STALE_FILE_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 失败/悬挂图片 24h 清理
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
const SENSITIVE_BREAKER_THRESHOLD = 3; // 连续 3 次判定为 sensitive 即熔断
const SENSITIVE_BREAKER_COOLDOWN_MS = 30 * 60 * 1000;
const VALID_CATEGORIES: Category[] = ['dev', 'meeting', 'comm', 'docs', 'design', 'research', 'leisure', 'other'];

interface QueueItem {
  id: number;
  filePath: string;
}

let running = false;
let timer: ReturnType<typeof setTimeout> | null = null;
let cleanupTimer: ReturnType<typeof setInterval> | null = null;
let queue: QueueItem[] = [];
let queueBusy = false;
let consecutiveSensitive = 0;
let sensitiveBreakerUntil = 0;

function tick(): void {
  if (!running) return;
  void captureOnce().finally(() => {
    const settings = getSettings();
    scheduleNext(settings.screenshots.intervalMin);
  });
}

function scheduleNext(intervalMin: number): void {
  if (!running) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(tick, Math.max(1, intervalMin) * 60_000);
}

async function captureOnce(): Promise<void> {
  const settings = getSettings();
  if (!settings.screenshots.enabled) return;
  if (shouldSkipCaptureNow()) return;
  if (checkScreenRecordingPermission() !== 'granted') return;
  if (Date.now() < sensitiveBreakerUntil) return; // 敏感内容熔断冷却期，暂停捕获

  const dir = resolveScreenshotsDir();
  const ts = Date.now();
  const filePath = path.join(dir, `${ts}.jpg`);

  try {
    await execFileAsync('screencapture', ['-x', '-m', '-t', 'jpg', filePath]);
  } catch {
    return; // 捕获失败（权限被临时收回、屏幕锁定等）：静默跳过，不留垃圾文件记录
  }
  if (!fs.existsSync(filePath)) return;

  try {
    await execFileAsync('sips', ['-Z', '1400', filePath]);
  } catch {
    // 缩放失败不致命，继续用原图分析
  }

  const app = getCurrentForegroundApp() ?? '';
  const row = insertScreenshot({ ts, app, path: filePath });
  queue.push({ id: row.id, filePath });
  void processQueue();
}

function execFileAsync(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 15_000 }, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

async function processQueue(): Promise<void> {
  if (queueBusy) return;
  queueBusy = true;
  try {
    while (queue.length > 0) {
      const item = queue.shift();
      if (!item) continue;
      await analyzeWithRetry(item);
    }
  } finally {
    queueBusy = false;
  }
}

async function analyzeWithRetry(item: QueueItem): Promise<void> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt <= CAPTURE_RETRY_LIMIT; attempt++) {
    try {
      await analyzeOnce(item);
      return;
    } catch (err) {
      lastError = err;
    }
  }
  console.warn(`[screenshots] 分析失败（已重试）：${humanizeProviderError(lastError)}`);
  updateScreenshotAnalysis(item.id, { status: 'failed', summary: '', category: null });
  // 失败的图片保留，等 24h 清理任务兜底删除，不在这里立即删。
}

interface ParsedVisionResult {
  summary: string;
  category: Category | null;
  sensitive: boolean;
}

function parseVisionResponse(raw: string): ParsedVisionResult {
  let jsonText = raw.trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('无法从模型输出中提取 JSON');
    jsonText = match[0];
    parsed = JSON.parse(jsonText);
  }
  if (typeof parsed !== 'object' || parsed === null) throw new Error('模型输出的 JSON 不是对象');
  const obj = parsed as Record<string, unknown>;
  const summary = typeof obj.summary === 'string' ? obj.summary : '';
  const categoryRaw = typeof obj.category === 'string' ? obj.category : null;
  const category = categoryRaw && (VALID_CATEGORIES as string[]).includes(categoryRaw) ? (categoryRaw as Category) : null;
  const sensitive = obj.sensitive === true;
  return { summary, category, sensitive };
}

async function analyzeOnce(item: QueueItem): Promise<void> {
  const settings = getSettings();
  const provider = getProvider(settings);
  const raw = await provider.analyzeImage(item.filePath, VISION_PROMPT);
  const result = parseVisionResponse(raw);

  if (result.sensitive) {
    consecutiveSensitive += 1;
    if (consecutiveSensitive >= SENSITIVE_BREAKER_THRESHOLD) {
      sensitiveBreakerUntil = Date.now() + SENSITIVE_BREAKER_COOLDOWN_MS;
      console.warn(`[screenshots] 连续 ${consecutiveSensitive} 次检测到敏感内容，暂停截图 ${SENSITIVE_BREAKER_COOLDOWN_MS / 60_000} 分钟。`);
    }
    updateScreenshotAnalysis(item.id, { status: 'skipped', summary: '', category: null });
  } else {
    consecutiveSensitive = 0;
    updateScreenshotAnalysis(item.id, { status: 'analyzed', summary: result.summary, category: result.category });
  }
  await deleteFileIfNeeded(item.id, item.filePath);
}

async function deleteFileIfNeeded(id: number, filePath: string): Promise<void> {
  const settings = getSettings();
  if (settings.screenshots.keepAfterAnalysis) return;
  try {
    await fs.promises.unlink(filePath);
    markScreenshotDeleted(id);
  } catch {
    // 文件可能已经被删过，忽略
  }
}

/** 清理 24h 前仍处于 pending（应用崩溃导致悬挂）或 failed 状态的截图文件，只清磁盘不改 DB 状态语义。 */
function cleanupStaleFiles(): void {
  const rows = getStaleScreenshots(Date.now() - STALE_FILE_MAX_AGE_MS);
  for (const row of rows) {
    removeFileAndMark(row.id, row.path);
  }
}

function removeFileAndMark(id: number, filePath: string): void {
  if (filePath && fs.existsSync(filePath)) {
    try {
      fs.unlinkSync(filePath);
    } catch {
      // 忽略
    }
  }
  markScreenshotDeleted(id);
}

/**
 * 24h 清理任务与「本轮是否捕获」的开关无关：即使用户后来关闭了截图功能，之前遗留的失败/悬挂
 * 文件仍要被清理。因此在 app ready 时无条件调用一次，与 setScreenshotsEnabled 的开关状态解耦。
 */
export function initScreenshotsCleanup(): void {
  if (cleanupTimer) return;
  cleanupStaleFiles();
  cleanupTimer = setInterval(cleanupStaleFiles, CLEANUP_INTERVAL_MS);
}

export function startScreenshots(): void {
  if (running) return;
  running = true;
  tick();
}

export function stopScreenshots(): void {
  running = false;
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
}

export function setScreenshotsEnabled(enabled: boolean): void {
  if (enabled) startScreenshots();
  else stopScreenshots();
}
