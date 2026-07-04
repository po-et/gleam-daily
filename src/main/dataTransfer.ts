// v1.3 数据导出 / 导入（SPEC §17.D）。
// 导出：脱敏 settings + 全表（screenshots 去掉 path）→ JSON 文件。
// 导入：校验 schemaVersion===1 → 事务内 clearAllData + 逐表插入（重新自增 id；meta 全量覆盖）→ 不导入 settings。
import fs from 'node:fs';
import { BrowserWindow, app, dialog } from 'electron';
import type { ExportResult, ImportResult } from '../shared/types';
import { clearAllData, getDb } from './db';
import { getSettings } from './settings';
import { getMainWindow } from './windows';

const SCHEMA_VERSION = 1;

// 逻辑名（导出 JSON 里的 data.<key>）↔ 物理表名。
const TABLE_MAP: { key: string; table: string }[] = [
  { key: 'sessions', table: 'sessions' },
  { key: 'screenshots', table: 'screenshots' },
  { key: 'notes', table: 'notes' },
  { key: 'gitCommits', table: 'git_commits' },
  { key: 'reports', table: 'reports' },
  { key: 'manualRecords', table: 'manual_records' },
  { key: 'meta', table: 'meta' },
];

interface ColumnSpec {
  name: string;
  fallback: unknown;
}

// 各表的可导入列 + 缺省值（缺失/为 null 时用缺省值；screenshots 的 path 导出时被剥离，导入按空处理）。
const TABLE_COLUMNS: Record<string, ColumnSpec[]> = {
  sessions: [
    { name: 'start_ts', fallback: 0 },
    { name: 'end_ts', fallback: 0 },
    { name: 'app', fallback: '' },
    { name: 'title', fallback: '' },
    { name: 'category', fallback: 'other' },
  ],
  screenshots: [
    { name: 'ts', fallback: 0 },
    { name: 'status', fallback: 'analyzed' },
    { name: 'summary', fallback: '' },
    { name: 'category', fallback: null },
    { name: 'app', fallback: '' },
    { name: 'path', fallback: '' },
    { name: 'deleted', fallback: 1 }, // 导入的截图无对应磁盘文件，标记为已删除
  ],
  notes: [
    { name: 'ts', fallback: 0 },
    { name: 'content', fallback: '' },
  ],
  git_commits: [
    { name: 'repo', fallback: '' },
    { name: 'hash', fallback: '' },
    { name: 'ts', fallback: 0 },
    { name: 'message', fallback: '' },
    { name: 'files_changed', fallback: 0 },
    { name: 'insertions', fallback: 0 },
    { name: 'deletions', fallback: 0 },
  ],
  reports: [
    { name: 'type', fallback: 'daily' },
    { name: 'template', fallback: 'standard' },
    { name: 'period_start', fallback: '' },
    { name: 'period_end', fallback: '' },
    { name: 'content_md', fallback: '' },
    { name: 'model', fallback: '' },
    { name: 'created_ts', fallback: 0 },
  ],
  manual_records: [
    { name: 'ts', fallback: 0 },
    { name: 'category', fallback: 'other' },
    { name: 'title', fallback: '' },
    { name: 'content', fallback: '' },
    { name: 'source', fallback: 'manual' },
    { name: 'created_ts', fallback: 0 },
  ],
  meta: [
    { name: 'key', fallback: '' },
    { name: 'value', fallback: '' },
  ],
};

function parentWindow(): BrowserWindow | null {
  return BrowserWindow.getFocusedWindow() ?? getMainWindow();
}

function yyyymmdd(): string {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

function dumpTable(table: string): Record<string, unknown>[] {
  return getDb().prepare(`SELECT * FROM ${table}`).all() as Record<string, unknown>[];
}

function buildExportPayload(): Record<string, unknown> {
  const data: Record<string, unknown[]> = {};
  for (const { key, table } of TABLE_MAP) {
    let rows = dumpTable(table);
    if (table === 'screenshots') {
      // 导出里 path 无意义（图片阅后即焚），且不外泄本机路径。
      rows = rows.map((r) => {
        const { path: _drop, ...rest } = r;
        void _drop;
        return rest;
      });
    }
    // id 无需保留（导入重新自增）。
    data[key] = rows.map((r) => {
      const { id: _dropId, ...rest } = r;
      void _dropId;
      return rest;
    });
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    appVersion: safeAppVersion(),
    exportedAt: Date.now(),
    settings: getSettings(), // 脱敏视图（不含加密密钥）
    data,
  };
}

function safeAppVersion(): string {
  try {
    return app.getVersion();
  } catch {
    return '';
  }
}

export async function exportAll(): Promise<ExportResult> {
  const win = parentWindow();
  const options: Electron.SaveDialogOptions = {
    defaultPath: `gleam-daily-backup-${yyyymmdd()}.json`,
    filters: [{ name: 'JSON', extensions: ['json'] }],
  };
  const result = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options);
  if (result.canceled || !result.filePath) {
    return { ok: false, message: '' };
  }
  try {
    const payload = buildExportPayload();
    fs.writeFileSync(result.filePath, JSON.stringify(payload, null, 2), 'utf-8');
    return { ok: true, path: result.filePath };
  } catch (err) {
    return { ok: false, message: `导出失败：${err instanceof Error ? err.message : String(err)}` };
  }
}

interface ValidPayload {
  data: Record<string, unknown>;
}

function validatePayload(parsed: unknown): { ok: true; payload: ValidPayload } | { ok: false; message: string } {
  if (typeof parsed !== 'object' || parsed === null) {
    return { ok: false, message: '文件内容不是有效的备份对象。' };
  }
  const obj = parsed as Record<string, unknown>;
  if (obj.schemaVersion !== SCHEMA_VERSION) {
    return { ok: false, message: `不支持的备份版本（期望 schemaVersion=${SCHEMA_VERSION}）。` };
  }
  if (typeof obj.data !== 'object' || obj.data === null) {
    return { ok: false, message: '备份文件缺少 data 字段或格式不正确。' };
  }
  const data = obj.data as Record<string, unknown>;
  // 各已知键若存在必须为数组（缺失视为空表）。
  for (const { key } of TABLE_MAP) {
    const v = data[key];
    if (v !== undefined && !Array.isArray(v)) {
      return { ok: false, message: `备份文件的 data.${key} 字段格式不正确（应为数组）。` };
    }
  }
  return { ok: true, payload: { data } };
}

function insertRows(table: string, rows: unknown, cols: ColumnSpec[]): number {
  if (!Array.isArray(rows)) return 0;
  const colNames = cols.map((c) => c.name);
  const placeholders = colNames.map((c) => `@${c}`).join(', ');
  const stmt = getDb().prepare(`INSERT INTO ${table} (${colNames.join(', ')}) VALUES (${placeholders})`);
  let count = 0;
  for (const row of rows) {
    if (typeof row !== 'object' || row === null) continue;
    const r = row as Record<string, unknown>;
    const params: Record<string, unknown> = {};
    for (const col of cols) {
      const v = r[col.name];
      params[col.name] = v === undefined || v === null ? col.fallback : v;
    }
    stmt.run(params);
    count += 1;
  }
  return count;
}

export async function importAll(): Promise<ImportResult> {
  const win = parentWindow();
  const options: Electron.OpenDialogOptions = {
    properties: ['openFile'],
    filters: [{ name: 'JSON', extensions: ['json'] }],
  };
  const dialogResult = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
  if (dialogResult.canceled || dialogResult.filePaths.length === 0) {
    return { ok: false, message: '已取消导入。' };
  }
  const filePath = dialogResult.filePaths[0];
  if (!filePath) return { ok: false, message: '已取消导入。' };

  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return { ok: false, message: '文件不是有效的 JSON，无法导入。' };
  }

  const validation = validatePayload(parsed);
  if (!validation.ok) return { ok: false, message: validation.message };

  const { data } = validation.payload;
  try {
    const counts: Record<string, number> = {};
    const runImport = getDb().transaction(() => {
      clearAllData();
      for (const { key, table } of TABLE_MAP) {
        const cols = TABLE_COLUMNS[table];
        if (!cols) continue;
        counts[key] = insertRows(table, data[key], cols);
      }
    });
    runImport();
    return { ok: true, message: '导入成功，数据已恢复。', counts };
  } catch (err) {
    return { ok: false, message: `导入失败：${err instanceof Error ? err.message : String(err)}` };
  }
}
