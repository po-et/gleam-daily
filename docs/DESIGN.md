# 拾光日报 — UI 设计规范 v1.0（Claude 风格）

> 设计目标：安静、纸感、编辑部气质。像 Claude 官网/客户端一样：米白暖底、赤陶橙点缀、衬线标题、大量留白、极少装饰。**禁止**：蓝紫渐变、玻璃拟态、重阴影、彩色图标堆砌、任何"科技感"套路。

## 1. 设计令牌（theme.css 用 CSS 变量实现，:root 浅色 / [data-theme="dark"] 深色）

| Token | Light | Dark |
|---|---|---|
| --bg（窗口底） | #FAF9F5 | #262624 |
| --bg-sunken（侧栏/嵌入区） | #F0EEE6 | #1F1E1D |
| --surface（卡片） | #FFFFFF | #30302E |
| --border | #E3E1D9 | #3E3D3A |
| --border-strong | #D1CFC5 | #4A4945 |
| --text | #1F1E1D | #F0EFEA |
| --text-2（次要） | #6E6C64 | #A6A39A |
| --text-3（弱） | #9C9A90 | #706E67 |
| --accent（赤陶橙） | #C15F3C | #D97757 |
| --accent-hover | #A94F2F | #E08A6D |
| --accent-soft（橙 8% 底） | #C15F3C14 | #D9775722 |
| --danger | #B3452F | #E5735A |
| --ok | #6E7F5E | #8FA37E |
| --shadow-card | 0 1px 3px rgba(30,25,20,.06) | 0 1px 3px rgba(0,0,0,.3) |

- 圆角：卡片 14px，按钮/输入 10px，小标签 999px。
- 字体：标题/数字 `font-family: ui-serif, "Songti SC", Georgia, serif`（衬线是 Claude 气质的核心，中文标题即宋体）；正文 `-apple-system, "PingFang SC", sans-serif`；代码/时间 `ui-monospace, "SF Mono", monospace`。
- 字号：页大标题 26px serif 500；卡片标题 15px sans 600；正文 14px；辅助 12.5px；统计大数字 30px serif。
- 间距节奏：页面 padding 32px，卡片 padding 20px，卡片间 16px。
- 动效：仅 `transition: .15s ease`（背景/边框/颜色），页面切换淡入 .2s。无弹跳、无视差。
- 主题跟随系统 + 手动覆盖（settings.theme），`data-theme` 挂 html 上。

## 2. 通用组件

- **按钮**：primary（--accent 底、白字、10px 圆角、无阴影、hover 变 --accent-hover）；secondary（--surface 底 + --border 边、hover 边变 strong）；ghost（无底，文字 --text-2，hover --accent-soft 底）；danger 同 primary 用 --danger。高度 34px，padding 0 14px。
- **开关 Switch**：36×21 胶囊，开=accent，关=--border-strong，圆点白色，.15s。
- **输入框**：--surface 底、--border 边框，focus 边框变 accent + 1px accent 外圈（box-shadow 0 0 0 3px var(--accent-soft)）。
- **卡片 Card**：--surface + --border + --shadow-card + 14px 圆角。卡片标题行：左侧 serif 15px 标题，右侧可放 ghost 操作。
- **空态**：居中，一个手绘感极简线条 SVG（单色 --text-3，如一张纸/一杯茶的简笔画，24-32px 线条图），下方一句温和文案（见各页），再下方可选 primary CTA。
- **Toast**：右上角滑入，--surface 卡片样式，3s 自动消失。
- **分类色点**：8px 圆点用 CATEGORY_META.color；分类标签 = 色点 + 12.5px 文字。
- **侧栏**：宽 216px，--bg-sunken 底，右侧 1px --border。顶部 app 标识：赤陶橙圆角小方块 logo（20px）+「拾光日报」serif 16px；下方导航项（图标 16px 线性 + 文字 14px，选中态 = --surface 底白块 + 左侧文字变 --text，未选中 --text-2）；导航图标手写内联 SVG（stroke 1.5px，无填充）：今日=太阳、报告=纸张、素材=图层、设置=滑杆。侧栏底部：记录状态胶囊（绿点/灰点 + "记录中 · 3h24m" / "已暂停"，点击切换）。
- 窗口：`titleBarStyle: 'hiddenInset'`，顶部留 44px 拖拽区（-webkit-app-region: drag），内容通栏，无系统标题栏底色。主窗口默认 1080×720，min 900×600。

## 3. 今日页（默认页）

顶部：serif 大标题「7月4日，星期五」+ 右侧次要文字「已专注 4h 32m · 切换 46 次」。

从上到下：
1. **时间线卡片**（核心视觉）：横向 24h 轨道（默认视窗 08:00–22:00，超出范围有数据时自动扩展）。轨道高 44px，底为 --bg-sunken 圆角胶囊；每个 session 画成按分类着色的圆角小块（高 28px 垂直居中，最小宽 2px），块间贴合。hover 出浮层 tooltip：应用名 + 窗口标题（截断）+ 起止时间 + 时长。轨道下方时刻刻度（8:00 12:00 16:00 20:00，12px mono --text-3）。轨道上方右侧：分类图例（横排色点+label，只显示当日出现过的分类）。
2. **三张统计卡横排**：专注时长（serif 大数字 "4h 32m" + 副文案"活跃总时长"）；最长专注块（"1h 45m" + "14:00 开发"）；上下文切换（"46 次" + 温和评语：<30 "心流不错" / 30-80 "中等碎片化" / >80 "今天有点碎"）。
3. **双栏**：左「分类分布」卡片 —— 每分类一行：色点+label+横向细条(6px 高，宽度按占比，底 --bg-sunken)+右侧时长 mono；右「今日速记」卡片 —— 顶部输入框（placeholder "记一笔，AI 写日报时会参考…"，Enter 提交）+ 下方倒序列表（时间 mono 12px + 内容，hover 显删除 ghost 按钮）。
4. 底部通栏 CTA 卡片：--accent-soft 底、无边框，左侧文字「今天的故事已经记下 N 条，让 AI 帮你写成日报」+ 右侧 primary 按钮「生成今日日报」→ 跳报告页并触发生成。

空态（无 sessions）：时间线卡片内显示空态图+「还没有记录。保持这个窗口之外的任何工作，拾光会安静地记下来。」若权限缺失，改为警示条：「需要「自动化」权限才能记录前台应用 → [前往设置]」。

## 4. 报告页

左右布局：左列（固定 300px）生成器 + 历史；右侧预览编辑区。

- **生成器卡片**：类型分段控件（日报/周报/月报，胶囊分段）；日期选择（原生 input date，值默认今天）；模板下拉（标准/简洁/技术/OKR）；补充要求 textarea（可选，2 行）；素材预览行（调用 reports.preview，小字："素材：42 段活动 · 8 次提交 · 3 条速记"）；primary 大按钮「生成日报」。生成中：按钮变 loading（旋转圈 + "AI 撰写中…"，collecting 阶段显示"整理素材…"），禁用。
- **历史列表**：倒序，每项：类型小标签（日报=accent-soft底橙字）+ 日期 serif + 模板名 12px --text-3，选中项左侧 3px accent 竖条。hover 显删除。
- **右侧预览**：纸感 —— 内容区最大宽 720px 居中，--surface 卡片，padding 40px，Markdown 渲染（h2 用 serif 18px 带下边距、li 行距 1.7、strong 用 --accent 色不加粗底）。顶部工具条：「编辑 / 预览」ghost 切换、「复制 Markdown」、「导出 .md」（保存对话框）。编辑模式 = 等宽字体 textarea 同宽，失焦或点预览时保存（reports.update）。
- 生成完成：自动选中新报告并渲染，右上 toast「日报已生成」。
- 空态：「选一个日期，让 AI 把你的一天整理成报告。」

## 5. 素材页

顶部：日期选择（左右箭头 + date input）+ 四个 tab（活动 / 屏幕分析 / 提交 / 速记，胶囊分段控件）。

- 活动：表格风列表（时间段 mono / 分类色点 / 应用 / 标题截断 / 时长右对齐 mono）。> 100 条按小时折叠分组（小时行可折叠）。
- 屏幕分析：时间 + summary 列表；skipped 显示灰色"已跳过（隐私）"；顶部若截图功能关闭显示提示条 +「去开启」。
- 提交：按 repo 分组，组头 = repo 名 + 当日提交数；行 = mono 短 hash（7位，accent 色）+ message + 右侧 `+12 −4` 变更统计（ok/danger 色）。顶部「刷新」ghost 按钮（触发 collectCommits）。
- 速记：同今日页速记卡全宽版。

## 6. 设置页

单列滚动，每个分组一张卡片，卡片标题 serif。行样式：左标题+副说明（12.5px --text-2），右控件。

1. **记录**：启用记录 Switch；采样间隔（下拉 5/10/15/30s）；空闲判定（下拉 1/3/5/10 分钟）；排除应用（标签列表 + 输入添加，标签可删；副说明"排除的应用不记录窗口标题、不参与截图"）。
2. **屏幕分析**：启用 Switch（副说明讲清：定期截图→AI 提炼一句话→图片立即删除）；间隔（3/5/10/15 分钟）；保留原图 Switch（默认关，红色警示副文案）。
3. **Git**：仓库列表（路径 + 删除）、「添加仓库」「添加扫描目录」（pickDirectory）；作者过滤输入框（placeholder：留空则用 git 全局用户名）。
4. **AI 引擎**：provider 三选一卡片式单选（大卡片：名称+说明+右上单选点）——「Claude Code CLI · 推荐，使用本机已登录的 Claude Code，无需 API Key」（不可用时置灰+说明）/「Anthropic API · 自备 Key 直连」/「OpenAI 兼容 · 任意兼容端点」。选中后展开对应配置行（模型输入框、Key 密码输入框[已设置时显示掩码 + "更换" 按钮]、baseUrl）。角色描述 textarea（placeholder"如：后端工程师，负责订单系统…写日报时会用于把握口吻与重点"）。「测试连接」secondary 按钮 → 行内结果（ok 绿点文字/失败红点+原因）。
5. **外观与权限**：主题三选（跟随系统/浅色/深色，分段控件）；权限状态区：两行（自动化-记录前台应用 / 屏幕录制-截图分析），每行 = 状态点（granted 绿 denied 红 unknown 灰）+ 说明 + 「打开系统设置」ghost 按钮。
6. **数据**：数据位置（路径 + 「在 Finder 中显示」）；「清除所有数据」danger 按钮 → 确认弹层（自绘 modal，Claude 风格：--surface 卡片居中，遮罩 rgba(20,18,15,.4)）。
7. 页脚：版本号 + 「拾光日报 · 本地优先，你的数据不离开这台 Mac」12px --text-3 居中。

## 7. 速记小窗

360px 宽无边框窗口，--surface 底 14px 圆角（窗口透明+内容圆角），内部：顶部 12.5px --text-3「速记 · Enter 保存 / Esc 取消」+ 自增高 textarea（serif 15px，无边框，placeholder"此刻在做什么？"）。保存后小窗内闪现"✓ 已记下"随即关闭。

## 8. 文案基调

全中文；克制、温和、第一人称对话感；不用感叹号轰炸；错误信息给出下一步（"连接失败：无法访问 api.anthropic.com，请检查网络或代理"）。加载态用"整理素材…/AI 撰写中…"这类具体动词。
