# TeacherAgent 前端重构设计方案 v1

> 状态：提案（待评审）
> 日期：2026-07-17
> 范围：`src/` 前端（Vue 3 + TS + Vuetify 3 + Pinia），不涉及 Rust 后端与教学引擎逻辑变更。
> 关联文档：`docs/design.md`、`docs/project-status.md`、`docs/mvp-spec.md`

---

## 1. 现状诊断

### 1.1 当前结构

- 5 个页面：对话辅导 `/`、练习 `/practice`、仪表盘 `/dashboard`、知识图谱 `/knowledge-graph`、设置 `/settings`。
- 布局：左侧 252px 固定导航 rail（纯自定义 CSS），右侧内容区，`keep-alive` 保活。
- 组件已按领域分目录（chat / dashboard / learning / practice / settings），composables 抽取得当。

### 1.2 核心问题

| # | 问题 | 证据 | 影响 |
|---|------|------|------|
| P1 | **两套视觉语言并存** | Vuetify theme 是蓝色系（`#4a90d9`），`main.css` 的 atlas token 是纸感米色 + 藏青 + 琥珀 + Georgia 衬线 | Vuetify 组件（按钮、卡片、输入框、表格）与自定义区域风格割裂，界面像两个产品拼起来的 |
| P2 | **全局样式臃肿耦合** | `main.css` 1548 行，页面级类（`.chat-view`、`.settings-view`、`.page-header`、`.dashboard-*`）全部全局注册 | 改一个页面样式容易误伤其他页面；无法按需加载；命名冲突风险随页面增加线性上升 |
| P3 | **视图组件过胖** | `ChatView.vue` 1129 行、`KnowledgeGraphView.vue` 1219 行 | 模板、编排、样式混在一起，难以维护和 review |
| P4 | **无暗色模式** | Vuetify 只有 `teacherLight`，CSS 变量无暗色映射 | 桌面学习应用长时间使用，暗色是刚需 |
| P5 | **导航信息架构不合理** | 会话列表在 ChatView 内部 sidebar，全局 rail 与聊天 sidebar 双层并列，占横向空间；rail 底部有"旗舰版"占位卡片 | 对话页有效宽度被压缩；占位内容显得未完成 |
| P6 | **设计 token 不成体系** | 颜色有变量，但间距、圆角、阴影、字阶全部硬编码散在各处 | 无法统一调整密度和质感 |

### 1.3 保留资产

- atlas 纸感学术风的方向本身是对的（契合"AI 学习伙伴 / 书房"气质），不推倒重来，**做统一和深化**。
- composables / engine / services 分层不动，本次重构只动表现层。
- 组件领域目录划分保留。

---

## 2. 设计原则

1. **单一设计来源**：一套 token 同时驱动 Vuetify theme 和自定义 CSS，消灭 P1。
2. **对话优先**：对话辅导是核心体验（design.md 明确要求"先把对话做到体验优秀"），布局资源向消息流倾斜。
3. **书房气质**：纸感、衬线标题、藏青 + 琥珀的学术配色，克制使用阴影和渐变；不追玻璃拟态潮流。
4. **密度可调**：桌面应用信息密度优先，提供舒适 / 紧凑两档密度。
5. **小步可运行**：每一步迁移都保持应用可构建、可运行、可测试（符合 AGENTS.md 开发纪律）。

---

## 3. 设计 Token 系统（Design Tokens）

### 3.1 结构

新增 `src/styles/tokens.css` 作为唯一 token 来源，三层：

```
tokens.css          ← 原始 token（色板、字阶、间距、圆角、阴影）
  ├─ :root          ← 浅色（默认）
  └─ [data-theme="dark"]  ← 暗色映射
vuetify.ts          ← 从同一色板取值，消灭双主题
main.css            ← 只留 reset + 全局版式（目标 < 200 行）
```

### 3.2 色彩

| Token | 浅色 | 暗色 | 用途 |
|-------|------|------|------|
| `--t-bg` | `#f7f3eb` | `#14161c` | 应用底色（纸感米白 / 墨蓝黑） |
| `--t-surface` | `#fffdf8` | `#1c1f27` | 卡片、面板 |
| `--t-surface-soft` | `#fbf7ef` | `#232733` | 次级面板、hover 底 |
| `--t-ink` | `#162033` | `#e8e4da` | 主文字 |
| `--t-muted` | `#6a7280` | `#9aa0ae` | 次要文字 |
| `--t-line` | `#e3ded3` | `#2e3340` | 分隔线 |
| `--t-primary` | `#0d3264` | `#7ea6e0` | 主色（藏青；暗色下提亮保对比度） |
| `--t-primary-soft` | `#e7f0fc` | `#22304a` | 主色浅底（标签、选中态） |
| `--t-accent` | `#d69a2d` | `#e0b054` | 强调色（琥珀，用于 eyebrow、重点标记） |
| `--t-success` | `#3d8a62` | `#6cb88f` | 掌握 / 正确 |
| `--t-danger` | `#b6534b` | `#d9837b` | 薄弱 / 错误 |

语义规则：学科配色（9 学科）只允许出现在知识图谱节点和学科标签，**不进入全局 chrome**。

### 3.3 字体与字阶

- 标题：`"Noto Serif SC", Georgia, serif`（替换纯 Georgia，中文标题不再回退到无衬线）
- 正文 / UI：`"Aptos", "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif`（沿用）
- 字阶（rem）：`--t-fs-display:1.75` / `--t-fs-title:1.25` / `--t-fs-body:0.9375` / `--t-fs-small:0.8125` / `--t-fs-caption:0.75`

### 3.4 间距、圆角、阴影

- 间距基数 4px：`--t-sp-1..8`（4 / 8 / 12 / 16 / 24 / 32 / 48 / 64）
- 圆角：`--t-radius-s:6px`（芯片、标签）/ `--t-radius-m:10px`（卡片、按钮）/ `--t-radius-l:16px`（面板、对话框）
- 阴影两级：`--t-shadow-1`（卡片静置）/ `--t-shadow-2`（浮层、popover），暗色下阴影换为 1px 亮边。

### 3.5 Vuetify 对接

`vuetify.ts` 的 `teacherLight` 改为从同一色板取值（`primary: #0d3264` 等），新增 `teacherDark`，`defaults` 增补 `VCard/VBtn` 的 `elevation: 0` + 边框风格，让 Vuetify 组件默认呈现"纸感描边卡片"而非 Material 阴影。

---

## 4. 信息架构与导航

### 4.1 导航重构

- 全局 rail 从 252px 收窄为 **72px 图标 rail**（图标 + tooltip），hover 或点击展开为 240px 抽屉；释放约 180px 横向空间给对话页。
- rail 内容：品牌标 → 对话 / 练习 / 仪表盘 / 知识图谱 → 底部主题切换 + 设置。移除"旗舰版"占位卡片。
- 对话页内部改为**三栏**（见 5.1），会话列表收进对话页左栏，不再与全局导航争层级。

### 4.2 路由不变

保持现有 5 条路由与懒加载；新增路由 meta（`title`、`icon`），供 rail 和页头统一消费，消除硬编码导航项。

---

## 5. 页面设计

### 5.1 对话辅导（核心页，重点重构）

三栏布局，两栏可折叠：

```
┌──────────────────────────────────────────────────────────────┐
│ 顶栏：学科切换 · 会话标题(可编辑) · Provider 状态 · 面板开关 │
├──────────┬───────────────────────────────────┬───────────────┤
│ 会话列表  │            消息流                  │ 学习上下文栏   │
│ 240px    │  自适应，max-width 760 居中        │ 300px，可收起  │
│ 可收起    │  · 导师消息带引导标签(追问/提示)    │ · 当前知识点   │
│ · 搜索    │  · 学生消息右置纸感气泡            │ · 掌握度微条   │
│ · 归档分组│  · 流式打字 + 公式/代码渲染        │ · 学习路径     │
│          │  · 引用知识节点 chips              │ · 文档上下文   │
├──────────┴───────────────────────────────────┴───────────────┤
│ 输入区：多行自增高 · 附件 · 发送/停止 · 苏格拉底提示（引导语） │
└──────────────────────────────────────────────────────────────┘
```

要点：
- **消息流居中限宽 760px**：长文本可读性，两侧留白呈现纸感。
- **导师消息加"引导类型"标签**（追问 / 提示 / 反例 / 总结），色用 `--t-accent` 描边 chip——把教学法显性化，这是产品和普通聊天框的差异化记忆点。
- 空状态：学科相关的开场引导卡片（现有 welcomeMessages 逻辑保留，视觉升级）。
- 右栏学习上下文整合现有 `LearningPanel` + `DocumentContextPanel` + `PlannerSignalPanel` 为 tab 化单栏，默认收起，顶栏一键展开。

组件切分（拆解 1129 行 ChatView）：

```
ChatView.vue（< 250 行，纯编排）
├─ chat/ChatTopBar.vue        （学科、标题、Provider、面板开关）
├─ chat/ChatSessionRail.vue   （会话列表 + 搜索，现 ConversationSidebar 演进）
├─ chat/MessageFlow.vue       （现 MessageList + 空状态 + 引导标签）
├─ chat/TutorHintChip.vue     （引导类型标签）
├─ chat/ContextDock.vue       （右栏 tab 容器：知识点/路径/文档）
└─ chat/ChatComposer.vue      （沿用，视觉更新）
```

### 5.2 仪表盘

- 顶部 4 个 KPI 卡（连续学习天数、已掌握节点、进行中、本周练习正确率），雷达图与掌握度列表主从布局。
- 掌握度条统一用 success/danger 语义色，卡片全部走 token 化"描边纸卡"。

### 5.3 知识图谱

- 1219 行拆为 `KnowledgeGraphView`（编排）+ `graph/GraphCanvas.vue` + `graph/GraphLegend.vue` + `graph/NodeInspector.vue`。
- 节点色板限定学科色系，背景用 `--t-bg`，边用 `--t-line-strong`，选中态用 accent 描边 + 微放大，不用阴影糊。

### 5.4 练习

- 题卡居中 max-width 720，题干衬线、选项无衬线；进度条置顶；反馈区（PracticeFeedback）用 success/danger 语义底。
- 练习结束页：成绩总结 + "回到对话追问错题"直达按钮（打通练习→对话闭环，强化核心体验）。

### 5.5 设置

- 左 200px 锚点导航 + 右侧分组卡片（Provider / 知识库 / 隐私 / 外观），替代当前单长页滚动。
- 新增"外观"组：主题（浅/深/跟随系统）、密度（舒适/紧凑）、字号。

---

## 6. 样式架构

```
src/styles/
├─ tokens.css      新增：token 唯一定义（light + dark 映射）
├─ main.css        收缩：reset + body + 滚动条 + 全局工具类（目标 < 200 行）
└─ （页面样式回收到各 SFC scoped 块）
```

规则：
- 页面级类一律移入对应 SFC 的 `<style scoped>`，全局只保留真正跨页的。
- 组件内禁止硬编码 hex，一律 `var(--t-*)`；PR review 检查项。
- 迁移期用 codemod / 手工对照表把 `--atlas-*` 映射到 `--t-*`，最后删除旧 token。

---

## 7. 迁移计划（4 批，每批可独立运行验收）

| 批次 | 内容 | 验收 |
|------|------|------|
| M1 Token 统一 | 新增 tokens.css；vuetify.ts 双主题；main.css 变量换名 | 全站视觉无回归；Vuetify 组件呈现藏青纸感 |
| M2 导航 + 外壳 | 72px 图标 rail（可展开）；路由 meta；主题切换 + 暗色 | 5 页面导航正常；暗色全站可用 |
| M3 对话页重构 | 三栏布局；ChatView 拆分；引导标签 chip；ContextDock | 对话全链路（发送/流式/附件/搜索/文档）无回归；`npm run test` 通过 |
| M4 其余页面 | 仪表盘 / 图谱 / 练习 / 设置按 §5 落地 + main.css 瘦身 | main.css < 200 行；构建 chunk 不劣化（保持 < 500 kB） |

每批同步更新 `docs/project-status.md`；视觉走查记录在 `docs/verification-checklist.md`。

## 8. 非目标（本次不做）

- 不改 engine / services / stores 的业务逻辑接口。
- 不新增页面、不改路由结构。
- 不引入新 UI 库或重量级依赖。
- 不做移动端适配（桌面优先，布局弹性保留即可）。

## 9. 附：设计稿

高保真静态设计稿：`docs/design/chat-redesign-mock.html`（浏览器直接打开预览，展示 M3 对话页目标形态 + token 效果）。
