// Git 提交采集。见 docs/SPEC.md §9。
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { GitCommit } from '../shared/types';
import { getCommits, upsertCommit } from './db';
import { getSettings } from './settings';

const SCAN_MAX_DEPTH = 2;
const GIT_LOG_TIMEOUT_MS = 8_000;
const SHORTSTAT_RE = /^\s*(\d+)\s+files? changed(?:,\s*(\d+)\s+insertions?\(\+\))?(?:,\s*(\d+)\s+deletions?\(-\))?/;

// ---------------------------------------------------------------------------
// scanRoots -> 深度 2 查找 .git 目录
// ---------------------------------------------------------------------------

function findGitRepos(root: string, maxDepth: number): string[] {
  const found: string[] = [];

  function walk(dir: string, depth: number): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // 目录不存在/无权限：静默跳过
    }
    const hasGit = entries.some((e) => e.name === '.git');
    if (hasGit) {
      found.push(dir);
      return; // 找到仓库后不再继续往下找嵌套仓库（避免子模块/嵌套仓库重复计入）
    }
    if (depth >= maxDepth) return;
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith('.')) continue;
      if (entry.name === 'node_modules') continue; // 常见的深且无意义的子树，跳过以控制扫描开销
      walk(path.join(dir, entry.name), depth + 1);
    }
  }

  walk(root, 0);
  return found;
}

function resolveRepoPaths(): string[] {
  const settings = getSettings();
  const repos = new Set<string>();
  for (const p of settings.git.repoPaths) {
    if (p.trim()) repos.add(p);
  }
  for (const root of settings.git.scanRoots) {
    if (!root.trim()) continue;
    for (const found of findGitRepos(root, SCAN_MAX_DEPTH)) {
      repos.add(found);
    }
  }
  return [...repos];
}

// ---------------------------------------------------------------------------
// git log 解析
// ---------------------------------------------------------------------------

interface ParsedCommit {
  hash: string;
  ts: number;
  message: string;
  filesChanged: number;
  insertions: number;
  deletions: number;
}

/**
 * 解析 `git log --pretty=format:%H%x1f%at%x1f%s --shortstat` 的输出。
 * 每条提交是一行 header（含 \x1f 分隔符），后面可能跟一行 shortstat（没有变更的提交，例如
 * --allow-empty，则完全没有 shortstat 行）；shortstat 的 insertions/deletions 字段也可能各自缺失
 * （比如只增不减、或反之），需要用可选捕获组分别处理，缺失时记 0。
 */
export function parseGitLog(stdout: string): ParsedCommit[] {
  const lines = stdout.split('\n');
  const commits: ParsedCommit[] = [];
  let pending: ParsedCommit | null = null;

  const flush = (): void => {
    if (pending) commits.push(pending);
    pending = null;
  };

  for (const line of lines) {
    if (line === '') continue;
    if (line.includes('\x1f')) {
      flush();
      const parts = line.split('\x1f');
      const hash = parts[0] ?? '';
      const atStr = parts[1] ?? '0';
      const message = parts.slice(2).join('\x1f');
      const at = Number(atStr);
      pending = {
        hash,
        ts: Number.isFinite(at) ? at * 1000 : Date.now(),
        message,
        filesChanged: 0,
        insertions: 0,
        deletions: 0,
      };
      continue;
    }
    const match = SHORTSTAT_RE.exec(line);
    if (match && pending) {
      pending.filesChanged = Number(match[1] ?? 0);
      pending.insertions = Number(match[2] ?? 0);
      pending.deletions = Number(match[3] ?? 0);
    }
  }
  flush();
  return commits;
}

function toIso(ts: number): string {
  return new Date(ts).toISOString();
}

function runGitLog(repoPath: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd: repoPath, timeout: GIT_LOG_TIMEOUT_MS }, (error, stdout) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(stdout);
    });
  });
}

function gitConfigGet(repoPath: string, key: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile('git', ['config', key], { cwd: repoPath, timeout: 3_000 }, (error, stdout) => {
      if (error) {
        resolve(null);
        return;
      }
      const value = stdout.trim();
      resolve(value || null);
    });
  });
}

/** authorFilter 为空时按 SPEC 回退到该仓库自己的 `git config user.name`/`user.email`。 */
async function resolveAuthorFilter(repoPath: string, configured: string): Promise<string | null> {
  if (configured.trim()) return configured.trim();
  const email = await gitConfigGet(repoPath, 'user.email');
  if (email) return email;
  const name = await gitConfigGet(repoPath, 'user.name');
  if (name) return name;
  return null; // 既没配置也没有本地 git config：不加 --author 限制，采集该仓库全部提交
}

async function collectRepoCommits(repoPath: string, startTs: number, endTs: number, authorFilter: string): Promise<void> {
  const author = await resolveAuthorFilter(repoPath, authorFilter);
  const args = [
    'log',
    `--since=${toIso(startTs)}`,
    `--until=${toIso(endTs)}`,
    ...(author ? [`--author=${author}`] : []),
    '--pretty=format:%H%x1f%at%x1f%s',
    '--shortstat',
    '--no-merges',
  ];
  const stdout = await runGitLog(repoPath, args);
  const parsed = parseGitLog(stdout);
  const repoName = path.basename(repoPath) || repoPath;
  for (const c of parsed) {
    const data: Omit<GitCommit, 'id'> = {
      repo: repoName,
      hash: c.hash,
      ts: c.ts,
      message: c.message,
      filesChanged: c.filesChanged,
      insertions: c.insertions,
      deletions: c.deletions,
    };
    upsertCommit(data);
  }
}

/**
 * 现场扫描 repoPaths + scanRoots 下的全部仓库，`git log` 采集 [startTs, endTs] 时段的提交并
 * 幂等 UPSERT 入库，最后返回该时段内数据库中的全部提交（含本次新采到的与之前已缓存的）。
 * 任何单仓库失败（不存在/不是 git 目录/超时）均静默降级，不影响其他仓库。
 */
export async function collectCommits(startTs: number, endTs: number): Promise<GitCommit[]> {
  const settings = getSettings();
  const repoPaths = resolveRepoPaths();
  await Promise.all(
    repoPaths.map((repoPath) =>
      collectRepoCommits(repoPath, startTs, endTs, settings.git.authorFilter).catch(() => {
        // 静默降级：仓库不存在 / 不是 git 目录 / 超时 等，忽略即可
      }),
    ),
  );
  return getCommits(startTs, endTs);
}
