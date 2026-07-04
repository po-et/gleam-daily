# 开发指南

## 环境要求

- macOS（Apple Silicon）
- Node.js ≥ 20（本项目在 Node 23 下开发）
- Xcode Command Line Tools（编译 better-sqlite3 与生成应用图标需要）

## 常用命令

```bash
npm install         # 安装依赖；postinstall 跑 electron-rebuild，把 better-sqlite3 编译成匹配 Electron 的 ABI
npm run dev         # electron-vite dev，主进程/渲染层热重载
npm run typecheck   # tsconfig.node.json + tsconfig.web.json 两遍 --noEmit 严格检查
npm run build       # electron-vite build，产出 out/
npm run build:mac   # 打包 .dmg / .zip 到 release/（arm64，ad-hoc 签名）
npm run seed        # 向 userData 数据库注入今日演示数据（幂等，重复跑会先清当天）
bash scripts/make-icons.sh   # 用 Swift + CoreGraphics 重新生成应用图标与托盘模板图
```

## 架构约定

- **契约唯一真源**：`src/shared/` 下的类型、IPC 通道名、分类规则被三层共用。改契约必须同步
  `src/preload/index.ts`（`window.gleam` 白名单）与 `src/main/ipc.ts`（handler 注册），
  并保持 `docs/SPEC.md` 一致。
- **渲染层无 Node 权限**：`contextIsolation: true`，一切能力经 preload 显式暴露。
- **样式约定**：纯手写 CSS，主题令牌集中在 `src/renderer/src/theme.css`（浅/深两套 CSS 变量），
  禁止引入 UI 组件库；设计规范见 `docs/DESIGN.md`。
- **错误信息人话化**：主进程抛给 UI 的错误必须是用户能读懂、能行动的中文句子。

## 调试技巧

- `GLEAM_REMOTE_DEBUG=9333 npm run dev` 开启 CDP 远程调试端口，可用任意 CDP 客户端
  驱动页面、截图、直调 `window.gleam.*` 做端到端验证。
- 数据库在 `~/Library/Application Support/gleam-daily/gleam.db`（WAL），可直接用 `sqlite3` 查看。
- `GLEAM_USER_DATA=/path/to/dir` 覆盖 userData 根目录（最高优先级，DB / settings.json / 截图目录全部改写到该目录）。
  用于 E2E / 自动化测试跑在独立数据目录，避免污染真实用户数据；解析逻辑见 `src/main/paths.ts` 的 `resolveUserDataDir`。
- 脚本需要访问数据库时**不能用系统 Node**（better-sqlite3 的 ABI 是 Electron 的），要用：
  `ELECTRON_RUN_AS_NODE=1 npx electron ./node_modules/tsx/dist/cli.mjs <script.ts>`。

## 工程决策记录

1. **claude/codex CLI 子进程**
   - GUI 进程的 PATH 不含 Homebrew 等目录，spawn 前手动拼接
     `/usr/local/bin:/opt/homebrew/bin:~/.local/bin:~/.codex/bin`。
   - stdin 必须显式 `'ignore'`：claude CLI 在 `-p` 模式下会等待未关闭的空 stdin 管道，
     大 prompt 场景稳定失败（"no stdin data received"）。
   - cwd 固定为应用数据目录：CLI 会加载 cwd 所在项目的 CLAUDE.md / AGENTS.md 上下文，
     继承 Electron 的 cwd 会把无关项目内容混进报告。
   - codex 必须带 `--ignore-user-config`（隔离用户全局配置与 hooks，token 从 42k 降到 7k）、
     `--ephemeral`（不污染会话历史）、`-o <file>` 读结果（stdout 是日志不解析）；
     图片参数**必须用等号形式** `--image=<path>`（`-i` 是变长参数，空格形式会把 prompt 吞成第二个路径）。
2. **托盘图标打包**：`tray.ts` 打包后从 `process.resourcesPath` 读模板图，electron-builder
   需用 `extraResources` 显式拷贝 `resources/trayTemplate*.png`（默认只打包 `out/**`）。
3. **focusBlocks 缺口规则**：同分类 session 连续合并，但间隔超过 90s 视为断裂，
   避免睡眠/离开被算成整块专注。
4. **周报/月报层级汇总**：优先复用期间内已生成的日报作为素材（质量更高、token 更省），
   没有日报的天回退到原始数据聚合。
5. **screenshots.enabled 默认 true**：截图→AI 提炼→删图是产品核心体验；隐私由
   敏感熔断 + 排除名单 + 阅后即焚三层保障，而不是靠默认关闭。
6. **企业网络 TLS 拦截**：`npm install` / `electron-builder` 下载二进制若报
   `unable to get local issuer certificate`，仅对该条构建命令临时加
   `NODE_TLS_REJECT_UNAUTHORIZED=0`（可配 `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`）。
   运行时代码不涉及。
7. **@types/react-dom 版本**：与 @types/react 上游发布节奏偶尔不同步，锁 `^19.2.3` 即可。

## 发布流程

1. 更新 `package.json` 版本号
2. `npm run typecheck && npm run build:mac`
3. 产出 `release/拾光日报-<version>-arm64.dmg` / `.zip`，上传 GitHub Releases
4. 打 tag：`git tag v<version> && git push --tags`

> 当前为 ad-hoc 签名（`identity: null`），分发给他人需 Apple 开发者证书签名 + 公证（见 Roadmap）。
