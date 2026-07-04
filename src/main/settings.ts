// 设置读写：userData/settings.json + safeStorage 加密 API Key。
// 磁盘上存的是 PersistedSettings（含加密后的 key），对外（渲染层）只暴露 Settings（hasKey/keyMasked 脱敏视图）。
import fs from 'node:fs';
import type { AiProviderKind, DeepPartial, ReportTemplate, Settings } from '../shared/types';
import { resolveSettingsPath } from './paths';

type SecretKind = 'anthropic' | 'openaiCompat';

interface PersistedSettings {
  theme: Settings['theme'];
  tracking: Settings['tracking'];
  screenshots: Settings['screenshots'];
  git: Settings['git'];
  ai: {
    provider: AiProviderKind;
    anthropic: { model: string; apiKeyEnc: string | null; apiKeyMasked: string };
    claudeCli: { model: string };
    codexCli: { model: string };
    openaiCompat: { baseUrl: string; model: string; apiKeyEnc: string | null; apiKeyMasked: string };
    visionModel: string;
    roleContext: string;
  };
  report: Settings['report'];
}

const DEFAULT_TEMPLATE: ReportTemplate = 'standard';

function defaultPersistedSettings(): PersistedSettings {
  return {
    theme: 'system',
    tracking: {
      enabled: true,
      sampleIntervalSec: 10,
      idleThresholdSec: 180,
      excludedApps: [],
    },
    screenshots: {
      enabled: true,
      intervalMin: 5,
      keepAfterAnalysis: false,
    },
    git: {
      repoPaths: [],
      scanRoots: [],
      authorFilter: '',
    },
    ai: {
      provider: 'claude-cli',
      anthropic: { model: 'claude-sonnet-5', apiKeyEnc: null, apiKeyMasked: '' },
      claudeCli: { model: 'sonnet' },
      codexCli: { model: '' },
      openaiCompat: { baseUrl: '', model: '', apiKeyEnc: null, apiKeyMasked: '' },
      visionModel: 'claude-haiku-4-5-20251001',
      roleContext: '',
    },
    report: { defaultTemplate: DEFAULT_TEMPLATE },
  };
}

let cache: PersistedSettings | null = null;

function readFromDisk(): PersistedSettings {
  const filePath = resolveSettingsPath();
  const defaults = defaultPersistedSettings();
  if (!fs.existsSync(filePath)) {
    return defaults;
  }
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as DeepPartial<PersistedSettings>;
    return deepMerge(defaults, parsed);
  } catch {
    // 文件损坏/不可解析：保守回退到默认值，避免整个应用起不来。
    return defaults;
  }
}

function writeToDisk(settings: PersistedSettings): void {
  const filePath = resolveSettingsPath();
  fs.writeFileSync(filePath, JSON.stringify(settings, null, 2), 'utf-8');
}

function loadPersisted(): PersistedSettings {
  if (!cache) cache = readFromDisk();
  return cache;
}

function savePersisted(next: PersistedSettings): void {
  cache = next;
  writeToDisk(next);
}

/** 不带泛型的实际实现，避免递归调用触发 TS 对泛型参数的双向推断问题。 */
function deepMergeInternal(base: unknown, patch: unknown): unknown {
  if (patch === undefined || patch === null) return base;
  if (Array.isArray(base)) {
    return Array.isArray(patch) ? patch : base;
  }
  if (base !== null && typeof base === 'object' && typeof patch === 'object') {
    const result: Record<string, unknown> = { ...(base as Record<string, unknown>) };
    for (const key of Object.keys(patch as Record<string, unknown>)) {
      if (!(key in result)) continue; // 丢弃 base 中不存在的字段（例如 hasKey/keyMasked 这类派生只读字段）
      const baseVal = result[key];
      const patchVal = (patch as Record<string, unknown>)[key];
      if (
        baseVal !== null &&
        typeof baseVal === 'object' &&
        !Array.isArray(baseVal) &&
        patchVal !== null &&
        typeof patchVal === 'object' &&
        !Array.isArray(patchVal)
      ) {
        result[key] = deepMergeInternal(baseVal, patchVal);
      } else if (patchVal !== undefined) {
        result[key] = patchVal;
      }
    }
    return result;
  }
  return patch ?? base;
}

/** 通用深合并：只合并 base 中已存在的 key，数组与原始值整体替换，不做元素级合并。 */
function deepMerge<T>(base: T, patch: DeepPartial<NoInfer<T>> | undefined): T {
  return deepMergeInternal(base, patch) as T;
}

function maskKey(key: string): string {
  if (key.length <= 4) return '••••';
  return `••••${key.slice(-4)}`;
}

/** 尝试拿到 Electron safeStorage；非 Electron 主进程环境（如未来的测试脚本）下返回 null。 */
function tryGetSafeStorage(): { isEncryptionAvailable: () => boolean; encryptString: (s: string) => Buffer; decryptString: (b: Buffer) => string } | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const electron = require('electron') as { safeStorage?: unknown };
    return (electron.safeStorage as ReturnType<typeof tryGetSafeStorage>) ?? null;
  } catch {
    return null;
  }
}

function encryptSecret(plain: string): string {
  const safeStorage = tryGetSafeStorage();
  if (safeStorage && safeStorage.isEncryptionAvailable()) {
    return safeStorage.encryptString(plain).toString('base64');
  }
  // 极端兜底（safeStorage 不可用，例如缺少系统密钥链）：仍以 base64 存储，避免明文落盘，同时打印告警。
  console.warn('[settings] safeStorage 不可用，API Key 将以 base64（非加密）形式存储。');
  return Buffer.from(plain, 'utf-8').toString('base64');
}

function decryptSecret(encoded: string): string | null {
  const safeStorage = tryGetSafeStorage();
  const buf = Buffer.from(encoded, 'base64');
  if (safeStorage && safeStorage.isEncryptionAvailable()) {
    try {
      return safeStorage.decryptString(buf);
    } catch {
      return null;
    }
  }
  try {
    return buf.toString('utf-8');
  } catch {
    return null;
  }
}

function toPublicSettings(p: PersistedSettings): Settings {
  return {
    theme: p.theme,
    tracking: { ...p.tracking, excludedApps: [...p.tracking.excludedApps] },
    screenshots: { ...p.screenshots },
    git: { ...p.git, repoPaths: [...p.git.repoPaths], scanRoots: [...p.git.scanRoots] },
    ai: {
      provider: p.ai.provider,
      anthropic: { hasKey: p.ai.anthropic.apiKeyEnc !== null, keyMasked: p.ai.anthropic.apiKeyMasked, model: p.ai.anthropic.model },
      claudeCli: { ...p.ai.claudeCli },
      codexCli: { ...p.ai.codexCli },
      openaiCompat: {
        baseUrl: p.ai.openaiCompat.baseUrl,
        hasKey: p.ai.openaiCompat.apiKeyEnc !== null,
        keyMasked: p.ai.openaiCompat.apiKeyMasked,
        model: p.ai.openaiCompat.model,
      },
      visionModel: p.ai.visionModel,
      roleContext: p.ai.roleContext,
    },
    report: { ...p.report },
  };
}

export function getSettings(): Settings {
  return toPublicSettings(loadPersisted());
}

export function setSettings(patch: DeepPartial<Settings>): Settings {
  const current = loadPersisted();
  // Settings 与 PersistedSettings 的 ai.anthropic / ai.openaiCompat 形状不同（hasKey/keyMasked 是派生只读字段），
  // 用通用 deepMerge 会因为 key 不在 base 里而被安全丢弃，所以这里单独把可写字段（model / baseUrl / provider 等）摘出来再合并。
  const merged: PersistedSettings = {
    theme: patch.theme ?? current.theme,
    tracking: deepMerge(current.tracking, patch.tracking),
    screenshots: deepMerge(current.screenshots, patch.screenshots),
    git: deepMerge(current.git, patch.git),
    ai: {
      provider: patch.ai?.provider ?? current.ai.provider,
      anthropic: {
        ...current.ai.anthropic,
        model: patch.ai?.anthropic?.model ?? current.ai.anthropic.model,
      },
      claudeCli: deepMerge(current.ai.claudeCli, patch.ai?.claudeCli),
      codexCli: deepMerge(current.ai.codexCli, patch.ai?.codexCli),
      openaiCompat: {
        ...current.ai.openaiCompat,
        baseUrl: patch.ai?.openaiCompat?.baseUrl ?? current.ai.openaiCompat.baseUrl,
        model: patch.ai?.openaiCompat?.model ?? current.ai.openaiCompat.model,
      },
      visionModel: patch.ai?.visionModel ?? current.ai.visionModel,
      roleContext: patch.ai?.roleContext ?? current.ai.roleContext,
    },
    report: deepMerge(current.report, patch.report),
  };
  savePersisted(merged);
  return toPublicSettings(merged);
}

export function setSecret(which: SecretKind, key: string): void {
  const current = loadPersisted();
  const apiKeyEnc = key ? encryptSecret(key) : null;
  const apiKeyMasked = key ? maskKey(key) : '';
  const merged: PersistedSettings = {
    ...current,
    ai: {
      ...current.ai,
      [which]: { ...current.ai[which], apiKeyEnc, apiKeyMasked },
    },
  };
  savePersisted(merged);
}

/** 供 phase2 的 ai/ provider 模块调用：拿到解密后的明文 Key（永不发往渲染层）。 */
export function getDecryptedSecret(which: SecretKind): string | null {
  const enc = loadPersisted().ai[which].apiKeyEnc;
  if (!enc) return null;
  return decryptSecret(enc);
}

export function resetSettingsCache(): void {
  cache = null;
}
