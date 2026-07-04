// 演示数据填充脚本。见 docs/SPEC.md §14：
//   生成"今天 09:00 起 ~6h 的拟真 sessions 约 40 条、8 条 commits（两个 repo）、
//   3 条 notes、4 条截图分析行"，写入与 Electron 应用运行时完全相同的 DB 文件。
//
// 运行方式（package.json 的 `seed` script 已固定）：
//   ELECTRON_RUN_AS_NODE=1 electron ./node_modules/tsx/dist/cli.mjs scripts/seed-demo.ts
// 原因见 README.md「已知偏离 / 实现决策记录」第 1 条：better-sqlite3 的 native ABI 只匹配
// Electron 自带的 Node 运行时，必须借道 ELECTRON_RUN_AS_NODE 才能直接 require 它。
//
// 幂等性：sessions/screenshots/notes 没有天然唯一键，重复执行前先删掉「今天」范围内的旧演示数据
// 再插入；git commits 用确定性 hash（sha1(索引+消息) 而非随机数）配合 db.upsertCommit 的
// UPSERT（UNIQUE(repo, hash)）天然幂等，重复执行只会覆盖同一批行，不会累积。
import crypto from 'node:crypto';
import path from 'node:path';
import { categorize } from '../src/shared/categories';
import { addNote, getDb, insertScreenshot, insertSession, updateScreenshotAnalysis, upsertCommit } from '../src/main/db';
import { resolveScreenshotsDir } from '../src/main/paths';

function todayAt(hour: number, minute: number): number {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute, 0, 0).getTime();
}

function dayRange(): { start: number; end: number } {
  const start = todayAt(0, 0);
  return { start, end: start + 24 * 60 * 60 * 1000 };
}

/** [app, title, minutes] —— 覆盖开发为主、穿插会议/沟通/文档/浏览的一整个工作日。 */
const SESSION_SCRIPT: [string, string, number][] = [
  ['Code', 'tracker.ts — gleam-daily', 12],
  ['Code', 'screenshots.ts — gleam-daily', 8],
  ['iTerm2', 'npm run typecheck', 4],
  ['Code', 'git.ts — gleam-daily', 10],
  ['Safari', 'GitHub - gleam-daily/pull/42', 6],
  ['Code', 'ai/index.ts — gleam-daily', 9],
  ['微信', '', 3],
  ['Code', 'reports/collect.ts — gleam-daily', 11],
  ['腾讯会议', '晨会 Standup', 20],
  ['Code', 'reports/prompts.ts — gleam-daily', 8],
  ['iTerm2', 'git log --oneline', 3],
  ['Code', 'reports/generator.ts — gleam-daily', 14],
  ['Safari', 'Stack Overflow - node child_process spawn', 5],
  ['Code', 'ipc.ts — gleam-daily', 13],
  ['飞书', '产品讨论群', 4],
  ['Code', 'tray.ts — gleam-daily', 7],
  ['Notion', '拾光日报 - 需求笔记', 10],
  ['Code', 'windows.ts — gleam-daily', 6],
  ['Safari', 'MDN - Array.prototype.map', 4],
  ['腾讯会议', '需求评审', 25],
  ['Code', 'scripts/seed-demo.ts — gleam-daily', 9],
  ['网易云音乐', '', 5],
  ['Code', 'scripts/make-icons.swift — gleam-daily', 8],
  ['iTerm2', 'swift build', 3],
  ['Safari', 'GitHub - Pull Request #43 review', 7],
  ['Code', 'dayStats.ts — gleam-daily', 6],
  ['微信', '', 2],
  ['Code', 'reports/collect.ts 单测调试 — gleam-daily', 10],
  ['Notion', '周报草稿', 6],
  ['飞书', '技术群', 3],
  ['Code', 'screenshots.ts 修复 — gleam-daily', 9],
  ['iTerm2', 'electron-vite build', 4],
  ['Safari', '掘金 - Electron 打包最佳实践', 5],
  ['Code', 'ai/claude-cli.ts — gleam-daily', 11],
  ['腾讯会议', '下午同步', 15],
  ['Code', 'ai/anthropic.ts — gleam-daily', 8],
  ['Safari', '语雀 - 团队知识库', 4],
  ['Code', 'ai/openai-compat.ts — gleam-daily', 7],
  ['iTerm2', 'git commit', 2],
  ['Code', 'reports/collect.ts 补充测试 — gleam-daily', 10],
  ['微信', '', 3],
  ['Code', 'README.md 更新 — gleam-daily', 8],
  ['Safari', 'Google Docs - 日报模板', 6],
  ['Safari', '少数派 - 效率工具评测', 6],
  ['iTerm2', 'git push', 5],
  ['Code', '最终联调 — gleam-daily', 12],
];

function seedSessions(): { count: number; totalMs: number; startTs: number; endTs: number } {
  const db = getDb();
  const startTs = todayAt(9, 0);
  const dayEndBound = todayAt(23, 59);

  // 幂等：先清掉今天范围内的旧演示 session。
  const { start: dayStart, end: dayEnd } = dayRange();
  db.prepare(`DELETE FROM sessions WHERE start_ts >= ? AND start_ts < ?`).run(dayStart, dayEnd);

  let cursor = startTs;
  for (const [app, title, minutes] of SESSION_SCRIPT) {
    const durationMs = minutes * 60_000;
    const endTs = Math.min(cursor + durationMs, dayEndBound);
    const category = categorize(app, title);
    insertSession({ startTs: cursor, endTs, app, title, category });
    cursor = endTs;
  }

  return { count: SESSION_SCRIPT.length, totalMs: cursor - startTs, startTs, endTs: cursor };
}

interface CommitSeed {
  repo: string;
  message: string;
  filesChanged: number;
  insertions: number;
  deletions: number;
  hour: number;
  minute: number;
}

const COMMIT_SCRIPT: CommitSeed[] = [
  { repo: 'gleam-daily', message: '实现 tracker.ts 前台应用采样与 session 聚合', filesChanged: 4, insertions: 186, deletions: 12, hour: 9, minute: 40 },
  { repo: 'gleam-daily', message: '补充 git.ts 的 shortstat 解析与深度扫描', filesChanged: 3, insertions: 142, deletions: 8, hour: 10, minute: 25 },
  { repo: 'gleam-daily', message: '接入 claude-cli / anthropic / openai-compat 三个 AI Provider', filesChanged: 6, insertions: 210, deletions: 15, hour: 11, minute: 50 },
  { repo: 'gleam-daily', message: '完成 reports 生成流水线：collect/prompts/generator', filesChanged: 5, insertions: 175, deletions: 20, hour: 12, minute: 30 },
  { repo: 'gleam-daily', message: '修复截图分析队列的重试与熔断逻辑', filesChanged: 2, insertions: 64, deletions: 19, hour: 14, minute: 10 },
  { repo: 'gleam-daily-docs', message: '更新 SPEC 附录：AI Provider 超时与重试策略说明', filesChanged: 1, insertions: 38, deletions: 4, hour: 13, minute: 5 },
  { repo: 'gleam-daily-docs', message: '补充周报/月报素材复用规则的示例', filesChanged: 1, insertions: 52, deletions: 0, hour: 14, minute: 45 },
  { repo: 'gleam-daily-docs', message: '校对模板文案，修正标点与措辞', filesChanged: 2, insertions: 12, deletions: 9, hour: 15, minute: 20 },
];

function deterministicHash(seedKey: string): string {
  return crypto.createHash('sha1').update(seedKey).digest('hex');
}

function seedCommits(): number {
  for (let i = 0; i < COMMIT_SCRIPT.length; i++) {
    const c = COMMIT_SCRIPT[i];
    if (!c) continue;
    const hash = deterministicHash(`seed-commit-${i}-${c.repo}-${c.message}`);
    upsertCommit({
      repo: c.repo,
      hash,
      ts: todayAt(c.hour, c.minute),
      message: c.message,
      filesChanged: c.filesChanged,
      insertions: c.insertions,
      deletions: c.deletions,
    });
  }
  return COMMIT_SCRIPT.length;
}

const NOTE_SCRIPT: { hour: number; minute: number; content: string }[] = [
  { hour: 9, minute: 15, content: '早上先把 tracker 的断裂检测过一遍，睡眠场景容易漏测' },
  { hour: 13, minute: 40, content: '截图分析的敏感熔断阈值先定 3 次，后面看看要不要做成可配置' },
  { hour: 15, minute: 10, content: '周报复用日报这块要小心：日报没写完的天怎么办，先跳过就好' },
];

function seedNotes(): number {
  const db = getDb();
  const { start: dayStart, end: dayEnd } = dayRange();
  db.prepare(`DELETE FROM notes WHERE ts >= ? AND ts < ?`).run(dayStart, dayEnd);
  for (const n of NOTE_SCRIPT) {
    addNote(n.content, todayAt(n.hour, n.minute));
  }
  return NOTE_SCRIPT.length;
}

interface ScreenshotSeed {
  hour: number;
  minute: number;
  app: string;
  status: 'analyzed' | 'skipped';
  summary: string;
  category: ReturnType<typeof categorize> | null;
}

const SCREENSHOT_SCRIPT: ScreenshotSeed[] = [
  { hour: 9, minute: 20, app: 'Code', status: 'analyzed', summary: '在 VS Code 里编写 tracker.ts 的 session 聚合逻辑', category: 'dev' },
  { hour: 10, minute: 5, app: '腾讯会议', status: 'analyzed', summary: '参加需求评审会议，讨论报告生成的模板结构', category: 'meeting' },
  { hour: 13, minute: 15, app: 'Notion', status: 'analyzed', summary: '整理拾光日报的周报素材复用规则文档', category: 'docs' },
  { hour: 14, minute: 30, app: 'Safari', status: 'skipped', summary: '', category: null },
];

function seedScreenshots(): number {
  const db = getDb();
  const { start: dayStart, end: dayEnd } = dayRange();
  db.prepare(`DELETE FROM screenshots WHERE ts >= ? AND ts < ?`).run(dayStart, dayEnd);

  const dir = resolveScreenshotsDir();
  for (let i = 0; i < SCREENSHOT_SCRIPT.length; i++) {
    const s = SCREENSHOT_SCRIPT[i];
    if (!s) continue;
    const ts = todayAt(s.hour, s.minute);
    const fakePath = path.join(dir, `seed-demo-${i}.jpg`); // 演示行不落真实文件，字段只做占位
    const row = insertScreenshot({ ts, app: s.app, path: fakePath });
    updateScreenshotAnalysis(row.id, { status: s.status, summary: s.summary, category: s.category });
  }
  return SCREENSHOT_SCRIPT.length;
}

function formatDuration(ms: number): string {
  const totalMinutes = Math.round(ms / 60_000);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${h}h${m}m`;
}

function main(): void {
  const sessions = seedSessions();
  const commitCount = seedCommits();
  const noteCount = seedNotes();
  const screenshotCount = seedScreenshots();

  console.log('[seed-demo] 演示数据写入完成：');
  console.log(
    `  sessions: ${sessions.count} 条，${new Date(sessions.startTs).toLocaleTimeString()} - ${new Date(sessions.endTs).toLocaleTimeString()}，累计 ${formatDuration(sessions.totalMs)}`,
  );
  console.log(`  git commits: ${commitCount} 条（gleam-daily / gleam-daily-docs 两个仓库）`);
  console.log(`  notes: ${noteCount} 条`);
  console.log(`  screenshots: ${screenshotCount} 条（analyzed/skipped 混合）`);
}

main();
