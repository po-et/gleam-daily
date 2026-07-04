# 拾光日报 Gleam Daily — 产品与技术规格 v1.0

> 本文档由架构师（Fable 5）定稿，是编码的唯一权威依据。实现时不得偏离 IPC 契约、DB Schema、共享类型定义；其余实现细节可自行裁量，但必须保证可编译、可运行、无崩溃。

## 0. 一句话定位

macOS 本地日报助手：后台静默记录你的工作轨迹（前台应用时间线 + 可选截图分析 + Git 提交 + 手动速记），一键让 AI 生成日报/周报/月报。**数据 100% 存本地 SQLite，AI 请求直连服务商或走本机 Claude Code CLI。**

## 1. 技术栈（固定，不得更换）

- Electron（最新稳定版）+ electron-vite + TypeScript
- 渲染层：React 19 + 纯手写 CSS（CSS 变量主题，禁止引入 UI 组件库、禁止 tailwind；图表用手写 div/SVG，禁止 chart 库）
- 数据：better-sqlite3（native 模块，postinstall 跑 electron-rebuild）
- AI：`@anthropic-ai/sdk`（Anthropic 直连）；`claude` CLI 子进程（免 Key 模式）；OpenAI 兼容端点用原生 fetch 实现（不引 openai sdk）
- 打包：electron-builder（产出 .app / dmg，mac arm64）
- 系统交互全部走 macOS 自带 CLI/API：`osascript`（前台应用/窗口标题）、`screencapture`（截图）、`sips`（缩放）、Electron `powerMonitor`（空闲检测）、`systemPreferences.getMediaAccessStatus('screen')`（权限检查）、`safeStorage`（API Key 加密）
- 包管理：npm。Node 23 本机可用。

版本策略：以能安装成功的最新稳定版为准；若某版本安装/编译失败，允许降级并在 README 注明。

## 2. 目录结构（固定）

```
gleam-daily/
  package.json
  electron.vite.config.ts
  electron-builder.yml
  tsconfig.json  tsconfig.node.json  tsconfig.web.json
  resources/            # icon.icns, icon.png, trayTemplate.png, trayTemplate@2x.png
  scripts/
    make-icons.swift    # swift 脚本用 CoreGraphics 画应用图标 -> PNG
    make-icons.sh       # 调 swift + sips + iconutil 产出 icns 与托盘图
    seed-demo.ts        # 向 DB 注入演示数据（昨天+今天的 sessions/commits/notes）
  docs/SPEC.md  docs/DESIGN.md
  src/
    shared/
      types.ts          # 【契约】共享类型，见 §4，逐字实现
      ipc-channels.ts   # 【契约】IPC 通道名常量，见 §5
      categories.ts     # 分类定义+默认应用映射，见 §6
    main/
      index.ts          # app 入口：单实例锁、窗口/托盘、模块装配
      windows.ts        # 主窗口 + 速记小窗管理
      tray.ts           # 菜单栏托盘
      db.ts             # SQLite 打开/建表/迁移 + 全部查询函数
      settings.ts       # 设置读写（userData/settings.json + safeStorage 加密 key）
      tracker.ts        # 前台应用轮询→session 聚合（核心，见 §7）
      screenshots.ts    # 截图捕获+AI 分析流水线（见 §8）
      git.ts            # Git 提交采集（见 §9）
      ai/
        index.ts        # Provider 工厂 + testProvider
        anthropic.ts    # Anthropic SDK 直连（文本+vision）
        claude-cli.ts   # 子进程调 claude CLI（文本+vision via Read 工具）
        openai-compat.ts# OpenAI 兼容 chat/completions（文本+vision）
      reports/
        collect.ts      # 汇集某时段素材 → ReportMaterial
        prompts.ts      # 四种模板的 prompt 构建（见 §10）
        generator.ts    # 生成编排：collect→prompt→provider→存库，进度事件
      ipc.ts            # 全部 ipcMain.handle 注册，薄壳，逻辑在各模块
    preload/
      index.ts          # contextBridge 暴露 window.gleam（见 §5）
    renderer/
      index.html
      src/
        main.tsx  App.tsx  theme.css
        api.ts          # window.gleam 的类型化引用
        pages/ Today.tsx  Reports.tsx  Materials.tsx  Settings.tsx
        components/     # 侧栏、时间线、卡片、开关、Markdown 渲染等（见 DESIGN.md）
        lib/            # 时间格式化、markdown 简易渲染（手写，允许用 marked 这一个库）
```

## 3. 安全与隐私红线

- `contextIsolation: true`，`nodeIntegration: false`，渲染层只能经 preload 白名单 API 访问。
- API Key 用 `safeStorage.encryptString` 加密后 base64 存 settings.json；解密只在 main 进程，永不传给渲染层（渲染层只能看到 `hasKey: true` 和掩码尾 4 位）。
- 截图文件存 `userData/screenshots/`，分析完成后**立即删除**（除非设置 keepAfterAnalysis）。分析失败保留最多 24h 后清理。
- 排除应用列表内的应用处于前台时：不记录窗口标题（记为 app 名 + title=''）、不截图。
- AI 返回 `sensitive: true` 的截图分析：丢弃 summary，status 记 `skipped`。
- 设置页提供「清除所有数据」：删 DB 全表 + 截图目录（需二次确认）。

## 4. 共享类型（src/shared/types.ts，逐字实现）

```ts
export type Category = 'dev' | 'meeting' | 'comm' | 'docs' | 'design' | 'research' | 'leisure' | 'other';

export interface Session {
  id: number;
  startTs: number;      // epoch ms
  endTs: number;
  app: string;
  title: string;        // 窗口标题，可为 ''
  category: Category;
}

export interface ScreenshotAnalysis {
  id: number;
  ts: number;
  status: 'pending' | 'analyzed' | 'failed' | 'skipped';
  summary: string;      // AI 一句话描述，skipped/failed 时为 ''
  category: Category | null;
  app: string;          // 截图时的前台应用
}

export interface Note { id: number; ts: number; content: string; }

export interface GitCommit {
  id: number; repo: string; hash: string; ts: number;
  message: string; filesChanged: number; insertions: number; deletions: number;
}

export type ReportType = 'daily' | 'weekly' | 'monthly';
export type ReportTemplate = 'standard' | 'concise' | 'technical' | 'okr';

export interface Report {
  id: number; type: ReportType; template: ReportTemplate;
  periodStart: string;  // 'YYYY-MM-DD'
  periodEnd: string;
  contentMd: string; model: string; createdTs: number;
}

export interface FocusBlock { startTs: number; endTs: number; category: Category; }

export interface DayStats {
  date: string;                          // 'YYYY-MM-DD'
  totalActiveMs: number;
  byCategory: Partial<Record<Category, number>>;   // ms
  topApps: { app: string; ms: number }[];          // 前 8
  contextSwitches: number;               // 相邻 session 应用变化次数
  focusBlocks: FocusBlock[];             // 同类连续 >= 25min
}

export type PermissionState = 'granted' | 'denied' | 'unknown';

export interface TrackerStatus {
  enabled: boolean;
  screenshotEnabled: boolean;
  idle: boolean;
  lastSampleTs: number | null;
  currentApp: string | null;
  permissions: { screenRecording: PermissionState; automation: PermissionState };
}

export type AiProviderKind = 'claude-cli' | 'codex-cli' | 'anthropic' | 'openai-compat';

export interface Settings {
  theme: 'system' | 'light' | 'dark';
  tracking: {
    enabled: boolean;
    sampleIntervalSec: number;    // 默认 10
    idleThresholdSec: number;     // 默认 180
    excludedApps: string[];
  };
  screenshots: {
    enabled: boolean;             // 默认 true（v1.1 起：截图→AI 提炼→删图是产品核心体验）
    intervalMin: number;          // 默认 5
    keepAfterAnalysis: boolean;   // 默认 false
  };
  git: { repoPaths: string[]; scanRoots: string[]; authorFilter: string; };
  ai: {
    provider: AiProviderKind;
    anthropic: { hasKey: boolean; keyMasked: string; model: string };  // 默认 model 'claude-sonnet-5'
    claudeCli: { model: string };                                      // 默认 'sonnet'
    codexCli: { model: string };                                       // 默认 ''（留空用 codex 内置默认）；文本与视觉共用
    openaiCompat: { baseUrl: string; hasKey: boolean; keyMasked: string; model: string };
    visionModel: string;          // 截图分析用，默认 'claude-haiku-4-5-20251001'（cli 时用 'haiku'）
    roleContext: string;          // 用户角色描述，拼入 prompt
  };
  report: { defaultTemplate: ReportTemplate };
}

export interface ReportGenOptions {
  type: ReportType;
  date: string;            // daily: 该日; weekly: 该周任一天; monthly: 该月任一天
  template: ReportTemplate;
  extraInstructions?: string;
}

export type ReportProgress =
  | { stage: 'collecting' }
  | { stage: 'generating' }
  | { stage: 'done'; reportId: number }
  | { stage: 'error'; message: string };

export interface ProviderTestResult { ok: boolean; message: string; latencyMs?: number; }

export interface MaterialPreview {   // 生成前给用户看素材规模
  sessionCount: number; activeMs: number; screenshotCount: number;
  commitCount: number; noteCount: number; dailyReportCount: number; // weekly/monthly 时复用的日报数
}
```

## 5. IPC 契约（preload 暴露 `window.gleam`）

`src/shared/ipc-channels.ts` 定义通道名常量（`tracker:getStatus` 这种格式）。preload 暴露如下结构（全部返回 Promise，事件用 `(cb)=>unsubscribe` 模式）：

```ts
window.gleam = {
  tracker: {
    getStatus(): Promise<TrackerStatus>;
    setEnabled(b: boolean): Promise<void>;
    setScreenshotEnabled(b: boolean): Promise<void>;
    onStatus(cb: (s: TrackerStatus) => void): () => void;
  },
  data: {
    getSessions(startTs: number, endTs: number): Promise<Session[]>;
    getDayStats(date: string): Promise<DayStats>;
    getScreenshotAnalyses(startTs: number, endTs: number): Promise<ScreenshotAnalysis[]>;
    addNote(content: string): Promise<Note>;
    listNotes(startTs: number, endTs: number): Promise<Note[]>;
    deleteNote(id: number): Promise<void>;
    collectCommits(startTs: number, endTs: number): Promise<GitCommit[]>;  // 现场扫 repo + 入库缓存，幂等
  },
  reports: {
    preview(opts: ReportGenOptions): Promise<MaterialPreview>;
    generate(opts: ReportGenOptions): Promise<void>;   // 结果经 onProgress 回来
    onProgress(cb: (p: ReportProgress) => void): () => void;
    list(): Promise<Report[]>;
    get(id: number): Promise<Report | null>;
    update(id: number, contentMd: string): Promise<void>;
    remove(id: number): Promise<void>;
  },
  settings: {
    get(): Promise<Settings>;
    set(patch: DeepPartial<Settings>): Promise<Settings>;   // 返回合并后的
    setSecret(which: 'anthropic' | 'openaiCompat', key: string): Promise<void>;
    testProvider(): Promise<ProviderTestResult>;
    pickDirectory(): Promise<string | null>;   // 系统目录选择器（选 git 仓库/扫描根）
  },
  app: {
    getVersion(): Promise<string>;
    openExternal(url: string): Promise<void>;
    openPermissionSettings(which: 'screenRecording' | 'automation' | 'accessibility'): Promise<void>;
    clearAllData(): Promise<void>;
    isClaudeCliAvailable(): Promise<boolean>;
    isCodexCliAvailable(): Promise<boolean>;
    getDataDir(): Promise<string>;
    showDataDir(): Promise<void>;
  },
};
```

## 6. 分类与默认映射（src/shared/categories.ts）

```ts
export const CATEGORY_META: Record<Category, { label: string; color: string }> = {
  dev:      { label: '开发',   color: '#6E8898' },
  meeting:  { label: '会议',   color: '#D97757' },
  comm:     { label: '沟通',   color: '#C9A66B' },
  docs:     { label: '文档',   color: '#7D8F69' },
  design:   { label: '设计',   color: '#9C7C8C' },
  research: { label: '浏览调研', color: '#93A8BC' },
  leisure:  { label: '休息',   color: '#9B9A93' },
  other:    { label: '其他',   color: '#B5B3AB' },
};
```

默认应用→分类映射（子串匹配，大小写不敏感），至少覆盖：
- dev: Code, Cursor, IntelliJ, PyCharm, WebStorm, Xcode, Terminal, iTerm, Warp, Ghostty, Sourcetree, Fork, Tower, DataGrip, Sublime
- meeting: 腾讯会议, Zoom, 飞书会议, Teams, FaceTime
- comm: 微信, WeChat, 钉钉, DingTalk, 飞书, Lark, Slack, Telegram, QQ, 大象, Mail, 邮件
- docs: Word, Pages, Notion, Obsidian, Typora, 语雀, 石墨, WPS, TextEdit, Craft, Bear
- design: Figma, Sketch, Photoshop, Illustrator, Keynote, Canva
- research: Safari, Chrome, Arc, Edge, Firefox, Dia
- leisure: 网易云音乐, Music, Spotify, bilibili, YouTube, 爱奇艺, 腾讯视频, Steam
- 兜底 other

浏览器细分：若 app 是浏览器且 title 命中 dev 关键词（GitHub, Stack Overflow, localhost, MDN, 掘金, CSDN…）记 dev；命中文档关键词（飞书文档, Google Docs, 语雀, Confluence, wiki…）记 docs；命中视频娱乐关键词记 leisure；否则 research。

## 7. Tracker（tracker.ts）——核心模块

- 每 `sampleIntervalSec` 秒执行一次采样：
  - `powerMonitor.getSystemIdleTime() >= idleThresholdSec` → 视为 idle，结束当前 session，不采样。
  - 用一次 `osascript` 同时取前台应用名与窗口标题：
    ```applescript
    tell application "System Events"
      set p to first application process whose frontmost is true
      set appName to name of p
      try
        set winTitle to name of front window of p
      on error
        set winTitle to ""
      end try
    end tell
    return appName & linefeed & winTitle
    ```
    osascript 失败（无权限）→ 记录权限状态 automation=denied，session 记为 app='(未授权)'，并停止刷屏式报错（指数退避重试探测）。
  - 排除应用：title 置 ''。
- **Session 聚合**：内存维护 currentSession {app,title,category,startTs,lastTs}。新样本与当前相同（app+title 相同）→ 只推进 lastTs 并 UPDATE endTs（每次采样都写库，保证崩溃不丢）；不同 → 关闭当前，INSERT 新 session。相邻两次采样间隔 > 3×interval（睡眠/卡顿）→ 视为断裂，关闭旧 session。
- **降噪**：写库的 session 若持续 < 15s 且下一个 session 与上上一个相同（快速切换抖动），允许直接合并回去；实现上可简化为：查询层 getSessions 返回原始行，DayStats 计算时忽略 < 10s 的 session 计入 contextSwitches。
- powerMonitor `suspend`/`lock-screen` → 关闭当前 session；`resume`/`unlock-screen` → 重新开始。
- 日界（0点）跨越的 session 在查询层按天切分计算 stats（存储不切）。
- 状态变化（enabled/idle/currentApp/权限）推送 `tracker:status` 事件到所有窗口。

## 8. 截图流水线（screenshots.ts）

- 开关独立于 tracker，但依赖 tracker 的 idle/排除判断：idle 或前台是排除应用或屏幕录制权限未授予 → 跳过本轮。
- 每 `intervalMin` 分钟：`screencapture -x -m -t jpg <userData>/screenshots/<ts>.jpg`（主显示器）→ `sips -Z 1400` 缩放 → 入库 status=pending → 异步队列调用 vision 分析（并发 1，失败重试 1 次）。
- 分析 prompt（发给 visionModel）：要求返回严格 JSON：`{"summary": "一句话描述用户正在做的具体工作（中文，含关键实体如项目名/文档名）", "category": "dev|meeting|comm|docs|design|research|leisure|other", "sensitive": false}`。sensitive 判定：密码框、支付、银行、聊天中的私人内容、身份证件等。
- 结果写库；`sensitive:true` → status='skipped', summary=''。分析成功后删除图片文件（除非 keepAfterAnalysis）。
- 各 Provider 的 vision 通道：anthropic → messages API image block（base64）；openai-compat → image_url base64；claude-cli → `claude -p "<prompt，其中指明先 Read 该绝对路径图片>" --output-format json --allowedTools Read --model <visionModel>`，解析 stdout JSON 的 `result` 字段，再从中提取 JSON（容错：用正则截取第一个 `{...}` 块）。

## 9. Git 采集（git.ts）

- 设置里两类来源：`repoPaths`（明确指定的仓库）+ `scanRoots`（根目录，扫描深度 2 找 `.git`）。
- `collectCommits(start,end)`：对每个仓库执行
  `git log --since=<iso> --until=<iso> --author=<authorFilter，空则取 git config user.name/email> --pretty=format:%H%x1f%at%x1f%s --shortstat --no-merges`
  解析后 UPSERT 入库（repo+hash 唯一）。单仓库超时 8s 跳过。返回该时段全部 commits。
- 错误静默降级（仓库不存在/不是 git 目录 → 忽略）。

## 10. 报告生成（reports/）

**collect.ts**：给定时段产出 `ReportMaterial`：
- sessions → 聚合为「分类汇总（各类时长）+ 按应用聚合的条目（app、总时长、代表性 titles 去重取前 5）」，过滤 leisure 细节只留时长；
- screenshot summaries（时间序，最多 60 条，超出均匀抽样）；
- commits（按 repo 分组）；notes 全量；
- weekly/monthly：优先取该时段内已有 daily 报告（contentMd），作为高质量素材；没有日报的天回退用原始数据聚合。

**prompts.ts**：单条 user message（provider 层负责 system prompt = "你是一位严谨的工作汇报助手"）。结构：

```
【任务】基于以下客观工作记录，撰写 {date} 的{日报|周报|月报}。
【我的角色】{roleContext，空则省略}
【写作要求】
- 只依据给定数据，禁止编造未出现的工作内容；数据稀疏时如实写简短版本。
- 中文输出，Markdown 格式，不要代码块包裹，不要出现"以下是"之类的引导语。
- 时长数据仅作参考，不必逐条罗列时间。
- {模板要求}
【模板要求-standard】结构：## 今日概览（2-3句）/ ## 主要工作（按事项分点，写清做了什么、进展如何）/ ## 数据速览（专注时长、主要投入方向，1-2行）/ ## 明日计划（基于未完成事项合理推断，谨慎、可标注"待定"）
【模板要求-concise】总长不超过 200 字，3-6 个要点，直接列点，无标题。
【模板要求-technical】按项目/仓库组织；引用具体 commit 信息与文件变更规模；技术决策与遇到的问题单独成节。
【模板要求-okr】结构：## 本期进展（按目标/方向归组）/ ## 关键结果与量化数据 / ## 风险与阻塞 / ## 下期计划
【工作记录数据】
<时间线摘要>...（分类时长汇总 + 按应用条目）
<屏幕活动分析>...（如启用）
<Git 提交>...
<手动速记>...（用户主观补充，优先级最高，可直接采信）
{extraInstructions 作为附加要求}
```

**generator.ts**：`generate(opts)` → emit collecting → collect → emit generating → provider.chat() → 存 reports 表 → emit done。任何异常 → emit error（message 人话化：无 Key、网络失败、CLI 不存在等）。同一时刻只允许一个生成任务（并发保护，直接拒绝第二个并 emit error）。

## 11. AI Provider（ai/）

统一接口：
```ts
interface AiProvider {
  chat(prompt: string, opts?: { maxTokens?: number }): Promise<string>;
  analyzeImage(imagePath: string, prompt: string): Promise<string>;
  test(): Promise<ProviderTestResult>;
}
```
- **claude-cli**（默认，若 `app.isClaudeCliAvailable()`）：`spawn('claude', ['-p', prompt, '--output-format','json','--model', model])`，PATH 需拼上常见位置（`/usr/local/bin:/opt/homebrew/bin:$HOME/.local/bin`，Electron GUI 进程 PATH 不含它们）。超时 180s。解析 stdout JSON `.result`。`test()` 用 `claude -p "回复ok" --model haiku` 验证。
- **codex-cli**（v1.1 新增，本机已验证 codex-cli 0.131.0）：`spawn('codex', ['exec','--skip-git-repo-check','--ignore-user-config','--ephemeral','-s','read-only','--color','never','-o',<临时文件>, ...(model?['-m',model]:[]), prompt])`。最终回复从 `-o` 临时文件读取（stdout 是思考/日志，不解析），用完删除临时文件。vision 追加参数 `--image=<绝对路径>`（**必须用等号形式**：`-i` 是变长参数，空格形式会把 prompt 吞成第二个图片路径）。`--ignore-user-config` 必须带：隔离用户全局 config/hooks，省 token 且避免副作用；auth 不受影响。cwd 同 claude-cli 固定为 userData。文本超时 300s、vision 180s、test 120s。PATH 拼接同 claude-cli，另加 `$HOME/.codex/bin`。
- **anthropic**：SDK，`max_tokens: 4000`。
- **openai-compat**：`POST {baseUrl}/chat/completions`。
- 工厂 `getProvider(settings)`；vision 模型与文本模型可不同。

## 12. 托盘与速记

- Tray：template 图标；菜单：`今日已记录 {h}h{m}m`（禁用行）/ 暂停记录|恢复记录 / 快速速记 ⌥⌘N / 生成今日日报（打开主窗至报告页并自动触发）/ 打开拾光日报 / 退出。
- 全局快捷键 ⌥⌘N：打开速记小窗（360×行高自适应，无边框、置顶、居屏上 1/3，Claude 风格；Enter 提交 toast 反馈后关闭，Esc 关闭）。
- 关闭主窗口 = 隐藏（app 常驻托盘）；Dock 图标保留，点击 Dock 重新显示。

## 13. 主窗口信息架构（细节见 DESIGN.md）

侧栏四页：**今日**（时间线+统计+速记流）/ **报告**（生成器+历史）/ **素材**（sessions 明细、截图分析、commits、notes 四个 tab）/ **设置**（记录、截图、Git、AI、外观与权限、数据）。

## 14. 打包与脚本

- `npm run dev`（electron-vite dev）/ `npm run build:mac`（electron-vite build + electron-builder --mac --arm64，产出 dmg+zip 到 release/）
- `npm run seed`：跑 scripts/seed-demo.ts（用 better-sqlite3 直接写 userData DB：生成今天 09:00 起 ~6h 的拟真 sessions 约 40 条、8 条 commits(两个 repo)、3 条 notes、4 条截图分析行）。用于演示与 E2E 验证。
- appId `com.gleam.daily`，productName `拾光日报`。electron-builder mac 配置需含 `NSAppleEventsUsageDescription`（自动化权限用途说明）、`NSScreenCaptureUsageDescription`（infoPlist extendInfo）。签名用 ad-hoc（`identity: null`）。
- 图标：scripts/make-icons.sh 用 swift + CoreGraphics 画：#D97757 圆角矩形（22% 圆角）上一个米白 (#FAF9F5) 极简"日"字形几何图（两横一竖围合，或旭日半圆+横线），产出 1024 png → iconutil 生成 icns；托盘 22/44px 黑色 alpha 模板图（同一几何图形）。

## 15. 已知边界（v1 不做）

Windows 支持、多显示器截图、日历接入、企业协作、开机自启（设置页可留 Electron `setLoginItemSettings` 开关，做了更好）、自动更新。

## 16. 验收清单（完成后逐条自验）

1. `npm i` 干净安装成功，`npm run dev` 启动无红错。
2. 授权后 1 分钟内 sessions 表出现真实记录；切换应用产生新 session；今日页时间线可见。
3. 无自动化权限时应用不崩溃，设置页正确显示权限状态与引导按钮。
4. `npm run seed` 后今日页/素材页数据丰满；报告页用 claude-cli provider 生成 standard 日报成功、内容基于素材、保存进历史；weekly 复用日报生成成功。
5. 截图开关开启后（有屏幕录制权限）产生分析行且图片文件被删除。
6. 速记 ⌥⌘N 可用；托盘菜单各项可用；关窗后托盘常驻，Dock 点击恢复。
7. 设置修改立即生效并持久化；API Key 加密存储，重启后仍可用；testProvider 正常。
8. 清除所有数据后各页空态正常。
9. `npm run build:mac` 产出 .app，双击可启动并正常记录（ad-hoc 签名）。
10. 深浅色主题切换正常，UI 与 DESIGN.md 一致。
