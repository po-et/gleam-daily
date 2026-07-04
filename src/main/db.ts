// SQLite 打开/建表 + 全部查询与写入函数。全部用 prepared statements。
// 契约要求：db 路径解析必须能脱离 Electron app 对象独立工作（供 scripts/seed-demo.ts 等纯 Node 场景使用），
// 具体解析逻辑见 ./paths.ts。
import Database from 'better-sqlite3';
import type {
  Category,
  GitCommit,
  ManualRecord,
  ManualRecordSource,
  Note,
  Report,
  ReportTemplate,
  ReportType,
  ScreenshotAnalysis,
  Session,
} from '../shared/types';
import { resolveDbPath } from './paths';

export interface ScreenshotRow extends ScreenshotAnalysis {
  path: string;
  deleted: boolean;
}

let db: Database.Database | null = null;

/** 惰性打开单例连接；已打开则直接复用。 */
export function getDb(): Database.Database {
  if (db) return db;
  const dbPath = resolveDbPath();
  const instance = new Database(dbPath);
  instance.pragma('journal_mode = WAL');
  instance.pragma('foreign_keys = ON');
  migrate(instance);
  db = instance;
  return db;
}

/** 仅供测试/seed 脚本在需要时强制关闭连接。 */
export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}

function migrate(instance: Database.Database): void {
  instance.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      start_ts INTEGER NOT NULL,
      end_ts INTEGER NOT NULL,
      app TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_start_ts ON sessions(start_ts);
    CREATE INDEX IF NOT EXISTS idx_sessions_end_ts ON sessions(end_ts);

    CREATE TABLE IF NOT EXISTS screenshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      summary TEXT NOT NULL DEFAULT '',
      category TEXT,
      app TEXT NOT NULL DEFAULT '',
      path TEXT NOT NULL DEFAULT '',
      deleted INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_screenshots_ts ON screenshots(ts);

    CREATE TABLE IF NOT EXISTS notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts INTEGER NOT NULL,
      content TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_notes_ts ON notes(ts);

    CREATE TABLE IF NOT EXISTS git_commits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      repo TEXT NOT NULL,
      hash TEXT NOT NULL,
      ts INTEGER NOT NULL,
      message TEXT NOT NULL DEFAULT '',
      files_changed INTEGER NOT NULL DEFAULT 0,
      insertions INTEGER NOT NULL DEFAULT 0,
      deletions INTEGER NOT NULL DEFAULT 0,
      UNIQUE(repo, hash)
    );
    CREATE INDEX IF NOT EXISTS idx_git_commits_ts ON git_commits(ts);

    CREATE TABLE IF NOT EXISTS reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      template TEXT NOT NULL,
      period_start TEXT NOT NULL,
      period_end TEXT NOT NULL,
      content_md TEXT NOT NULL DEFAULT '',
      model TEXT NOT NULL DEFAULT '',
      created_ts INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_reports_created_ts ON reports(created_ts);

    -- v1.3：手动补录 / 传图识别（SPEC §17.0、§17.C）。source: 'manual' | 'image'。
    CREATE TABLE IF NOT EXISTS manual_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts INTEGER NOT NULL,
      category TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'manual',
      created_ts INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_manual_records_ts ON manual_records(ts);

    -- v1.3：通用 KV（记忆内容、调度器状态等，SPEC §17.0）。
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
}

// ---------------------------------------------------------------------------
// sessions
// ---------------------------------------------------------------------------

interface SessionRow {
  id: number;
  start_ts: number;
  end_ts: number;
  app: string;
  title: string;
  category: string;
}

function rowToSession(row: SessionRow): Session {
  return {
    id: row.id,
    startTs: row.start_ts,
    endTs: row.end_ts,
    app: row.app,
    title: row.title,
    category: row.category as Category,
  };
}

export function insertSession(data: { startTs: number; endTs: number; app: string; title: string; category: Category }): Session {
  const stmt = getDb().prepare(
    `INSERT INTO sessions (start_ts, end_ts, app, title, category) VALUES (@startTs, @endTs, @app, @title, @category)`,
  );
  const info = stmt.run(data);
  return { id: Number(info.lastInsertRowid), ...data };
}

export function updateSessionEnd(id: number, endTs: number): void {
  getDb().prepare(`UPDATE sessions SET end_ts = ? WHERE id = ?`).run(endTs, id);
}

/** 返回与 [startTs, endTs] 区间有重叠的全部 session，按 start_ts 升序。不做任何切分（切分在查询层/统计层做）。 */
export function getSessions(startTs: number, endTs: number): Session[] {
  const rows = getDb()
    .prepare<[number, number], SessionRow>(
      `SELECT * FROM sessions WHERE end_ts >= ? AND start_ts <= ? ORDER BY start_ts ASC`,
    )
    .all(startTs, endTs);
  return rows.map(rowToSession);
}

export function getLastSession(): Session | null {
  const row = getDb().prepare<[], SessionRow>(`SELECT * FROM sessions ORDER BY start_ts DESC LIMIT 1`).get();
  return row ? rowToSession(row) : null;
}

/** v1.3：用户在时间线上手动修正某条自动 session 的分类（SPEC §17.C）。 */
export function updateSessionCategory(id: number, category: Category): void {
  getDb().prepare(`UPDATE sessions SET category = ? WHERE id = ?`).run(category, id);
}

/** v1.3：删除一条自动 session 聚合行（仅删该行，不影响截图/速记，SPEC §17.C）。 */
export function deleteSession(id: number): void {
  getDb().prepare(`DELETE FROM sessions WHERE id = ?`).run(id);
}

// ---------------------------------------------------------------------------
// screenshots
// ---------------------------------------------------------------------------

interface ScreenshotDbRow {
  id: number;
  ts: number;
  status: string;
  summary: string;
  category: string | null;
  app: string;
  path: string;
  deleted: number;
}

function rowToScreenshot(row: ScreenshotDbRow): ScreenshotRow {
  return {
    id: row.id,
    ts: row.ts,
    status: row.status as ScreenshotAnalysis['status'],
    summary: row.summary,
    category: (row.category as Category | null) ?? null,
    app: row.app,
    path: row.path,
    deleted: row.deleted === 1,
  };
}

export function insertScreenshot(data: { ts: number; app: string; path: string }): ScreenshotRow {
  const stmt = getDb().prepare(
    `INSERT INTO screenshots (ts, status, summary, category, app, path, deleted)
     VALUES (@ts, 'pending', '', NULL, @app, @path, 0)`,
  );
  const info = stmt.run(data);
  return {
    id: Number(info.lastInsertRowid),
    ts: data.ts,
    status: 'pending',
    summary: '',
    category: null,
    app: data.app,
    path: data.path,
    deleted: false,
  };
}

export function updateScreenshotAnalysis(
  id: number,
  patch: { status: ScreenshotAnalysis['status']; summary: string; category: Category | null },
): void {
  getDb()
    .prepare(`UPDATE screenshots SET status = @status, summary = @summary, category = @category WHERE id = @id`)
    .run({ id, ...patch });
}

export function markScreenshotDeleted(id: number): void {
  getDb().prepare(`UPDATE screenshots SET deleted = 1 WHERE id = ?`).run(id);
}

/** 面向渲染层的查询：只返回契约里定义的字段（不含 path/deleted）。 */
export function getScreenshotAnalyses(startTs: number, endTs: number): ScreenshotAnalysis[] {
  const rows = getDb()
    .prepare<[number, number], ScreenshotDbRow>(`SELECT * FROM screenshots WHERE ts >= ? AND ts <= ? ORDER BY ts ASC`)
    .all(startTs, endTs);
  return rows.map((row) => {
    const full = rowToScreenshot(row);
    return { id: full.id, ts: full.ts, status: full.status, summary: full.summary, category: full.category, app: full.app };
  });
}

/** 面向主进程内部模块（screenshots.ts）：含文件路径与删除标记，用于清理磁盘文件。 */
export function getPendingScreenshots(): ScreenshotRow[] {
  const rows = getDb()
    .prepare<[], ScreenshotDbRow>(`SELECT * FROM screenshots WHERE status = 'pending' ORDER BY ts ASC`)
    .all();
  return rows.map(rowToScreenshot);
}

/**
 * 面向 screenshots.ts 的 24h 清理任务：找出 `beforeTs` 之前、仍未删除磁盘文件、
 * 且状态为 'pending'（应用崩溃导致悬挂）或 'failed'（分析失败）的截图，供清理磁盘文件用。
 */
export function getStaleScreenshots(beforeTs: number): ScreenshotRow[] {
  const rows = getDb()
    .prepare<[number], ScreenshotDbRow>(
      `SELECT * FROM screenshots WHERE deleted = 0 AND status IN ('pending', 'failed') AND ts < ? ORDER BY ts ASC`,
    )
    .all(beforeTs);
  return rows.map(rowToScreenshot);
}

// ---------------------------------------------------------------------------
// notes
// ---------------------------------------------------------------------------

interface NoteRow {
  id: number;
  ts: number;
  content: string;
}

function rowToNote(row: NoteRow): Note {
  return { id: row.id, ts: row.ts, content: row.content };
}

export function addNote(content: string, ts: number = Date.now()): Note {
  const stmt = getDb().prepare(`INSERT INTO notes (ts, content) VALUES (?, ?)`);
  const info = stmt.run(ts, content);
  return { id: Number(info.lastInsertRowid), ts, content };
}

export function listNotes(startTs: number, endTs: number): Note[] {
  const rows = getDb()
    .prepare<[number, number], NoteRow>(`SELECT * FROM notes WHERE ts >= ? AND ts <= ? ORDER BY ts DESC`)
    .all(startTs, endTs);
  return rows.map(rowToNote);
}

export function deleteNote(id: number): void {
  getDb().prepare(`DELETE FROM notes WHERE id = ?`).run(id);
}

// ---------------------------------------------------------------------------
// git commits
// ---------------------------------------------------------------------------

interface GitCommitRow {
  id: number;
  repo: string;
  hash: string;
  ts: number;
  message: string;
  files_changed: number;
  insertions: number;
  deletions: number;
}

function rowToCommit(row: GitCommitRow): GitCommit {
  return {
    id: row.id,
    repo: row.repo,
    hash: row.hash,
    ts: row.ts,
    message: row.message,
    filesChanged: row.files_changed,
    insertions: row.insertions,
    deletions: row.deletions,
  };
}

/** UPSERT by (repo, hash)。返回是否为新插入。 */
export function upsertCommit(data: Omit<GitCommit, 'id'>): void {
  getDb()
    .prepare(
      `INSERT INTO git_commits (repo, hash, ts, message, files_changed, insertions, deletions)
       VALUES (@repo, @hash, @ts, @message, @filesChanged, @insertions, @deletions)
       ON CONFLICT(repo, hash) DO UPDATE SET
         ts = excluded.ts,
         message = excluded.message,
         files_changed = excluded.files_changed,
         insertions = excluded.insertions,
         deletions = excluded.deletions`,
    )
    .run(data);
}

export function getCommits(startTs: number, endTs: number): GitCommit[] {
  const rows = getDb()
    .prepare<[number, number], GitCommitRow>(`SELECT * FROM git_commits WHERE ts >= ? AND ts <= ? ORDER BY ts DESC`)
    .all(startTs, endTs);
  return rows.map(rowToCommit);
}

// ---------------------------------------------------------------------------
// reports
// ---------------------------------------------------------------------------

interface ReportRow {
  id: number;
  type: string;
  template: string;
  period_start: string;
  period_end: string;
  content_md: string;
  model: string;
  created_ts: number;
}

function rowToReport(row: ReportRow): Report {
  return {
    id: row.id,
    type: row.type as ReportType,
    template: row.template as ReportTemplate,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    contentMd: row.content_md,
    model: row.model,
    createdTs: row.created_ts,
  };
}

export function insertReport(data: Omit<Report, 'id'>): Report {
  const stmt = getDb().prepare(
    `INSERT INTO reports (type, template, period_start, period_end, content_md, model, created_ts)
     VALUES (@type, @template, @periodStart, @periodEnd, @contentMd, @model, @createdTs)`,
  );
  const info = stmt.run(data);
  return { id: Number(info.lastInsertRowid), ...data };
}

export function listReports(): Report[] {
  const rows = getDb().prepare<[], ReportRow>(`SELECT * FROM reports ORDER BY created_ts DESC`).all();
  return rows.map(rowToReport);
}

export function getReport(id: number): Report | null {
  const row = getDb().prepare<[number], ReportRow>(`SELECT * FROM reports WHERE id = ?`).get(id);
  return row ? rowToReport(row) : null;
}

export function updateReport(id: number, contentMd: string): void {
  getDb().prepare(`UPDATE reports SET content_md = ? WHERE id = ?`).run(contentMd, id);
}

export function deleteReport(id: number): void {
  getDb().prepare(`DELETE FROM reports WHERE id = ?`).run(id);
}

// ---------------------------------------------------------------------------
// manual_records（手动补录 / 传图识别，SPEC §17.C）
// ---------------------------------------------------------------------------

interface ManualRecordRow {
  id: number;
  ts: number;
  category: string;
  title: string;
  content: string;
  source: string;
  created_ts: number;
}

function rowToManualRecord(row: ManualRecordRow): ManualRecord {
  return {
    id: row.id,
    ts: row.ts,
    category: row.category as Category,
    title: row.title,
    content: row.content,
    source: row.source as ManualRecordSource,
  };
}

export function insertManualRecord(data: {
  ts: number;
  category: Category;
  title: string;
  content: string;
  source: ManualRecordSource;
}): ManualRecord {
  const createdTs = Date.now();
  const info = getDb()
    .prepare(
      `INSERT INTO manual_records (ts, category, title, content, source, created_ts)
       VALUES (@ts, @category, @title, @content, @source, @createdTs)`,
    )
    .run({ ...data, createdTs });
  return {
    id: Number(info.lastInsertRowid),
    ts: data.ts,
    category: data.category,
    title: data.title,
    content: data.content,
    source: data.source,
  };
}

/** 时间序（升序），便于与 session 块合并成时间线。 */
export function listManualRecords(startTs: number, endTs: number): ManualRecord[] {
  const rows = getDb()
    .prepare<[number, number], ManualRecordRow>(`SELECT * FROM manual_records WHERE ts >= ? AND ts <= ? ORDER BY ts ASC`)
    .all(startTs, endTs);
  return rows.map(rowToManualRecord);
}

export function updateManualRecord(id: number, patch: { ts?: number; category?: Category; title?: string; content?: string }): void {
  const fields: string[] = [];
  const params: Record<string, unknown> = { id };
  if (patch.ts !== undefined) {
    fields.push('ts = @ts');
    params.ts = patch.ts;
  }
  if (patch.category !== undefined) {
    fields.push('category = @category');
    params.category = patch.category;
  }
  if (patch.title !== undefined) {
    fields.push('title = @title');
    params.title = patch.title;
  }
  if (patch.content !== undefined) {
    fields.push('content = @content');
    params.content = patch.content;
  }
  if (fields.length === 0) return;
  getDb()
    .prepare(`UPDATE manual_records SET ${fields.join(', ')} WHERE id = @id`)
    .run(params);
}

export function deleteManualRecord(id: number): void {
  getDb().prepare(`DELETE FROM manual_records WHERE id = ?`).run(id);
}

// ---------------------------------------------------------------------------
// meta（通用 KV：记忆内容、调度器状态等，SPEC §17.0）
// ---------------------------------------------------------------------------

export function getMeta(key: string): string | null {
  const row = getDb().prepare<[string], { value: string }>(`SELECT value FROM meta WHERE key = ?`).get(key);
  return row ? row.value : null;
}

export function setMeta(key: string, value: string): void {
  getDb()
    .prepare(`INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
    .run(key, value);
}

// ---------------------------------------------------------------------------
// 清除所有数据
// ---------------------------------------------------------------------------

/** 清空全部业务表（不含截图文件本身，磁盘文件清理由调用方 —— app:clearAllData handler —— 负责）。 */
export function clearAllData(): void {
  getDb().exec(`
    DELETE FROM sessions;
    DELETE FROM screenshots;
    DELETE FROM notes;
    DELETE FROM git_commits;
    DELETE FROM reports;
    DELETE FROM manual_records;
    DELETE FROM meta;
  `);
}
