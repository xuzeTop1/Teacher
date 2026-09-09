# TeacherAgent Verification Checklist

最后更新：2026-08-11（无设备跨层回放门禁）

本文是当前 Phase 0 / MVP 的操作型验证清单。它不替代 `docs/mvp-spec.md` 的验收标准，而是把验收标准转成可以逐项执行和记录结果的步骤。

## 0. 当前前置状态

- 最新自动门禁已通过：Teacher Vitest 69 个测试文件 / 1309 个测试，`npm run build`（main bundle 473.78 kB），Rust `cargo test --all-targets` 283/283、`cargo fmt --check`，Android 36 suites / 264 tests、`lintDebug`（0 errors / 12 warnings）、`assembleDebug`、`assembleDebugAndroidTest`。
- Node 协议镜像单独执行 `npm run test:protocol-mirror`：6 项通过、1 项因 Windows 符号链接权限按预期 skip、exit 0；`npm run test` 不再误收集 `node:test` 文件。
- approved/draft 发布级运行时隔离已完成：
  - Pack manifest `status` 为必填字段
  - packLoader 验证 manifest/seed status 一致性
  - 默认 Seed 只处理 approved Pack（145 节点）
  - 默认 Embedding 只处理 approved Pack
  - packSelection localStorage 迁移：v1 draft ID 被丢弃
  - UI 使用 getCatalogStatistics() 显示 approved/draft 双口径
- **Catalog 双口径**：正式 11 Pack / 145 节点 / 123 题；待审核 40 Pack / 631 节点 / 643 题

## 1. 自动验证

在继续拆 Rust 模块或进入实机验收前，先执行：

```powershell
npm run test
npm run build
cd src-tauri
cargo fmt
cargo check
cargo test
```

通过标准：

- `npm run test` 通过全部前端单元测试。
- `npm run build` 通过 TypeScript 与 Vite 构建。
- `cargo fmt` 无格式化失败。
- `cargo check` 编译通过。
- `cargo test` 通过全部 Rust 测试。

当前记录：

- 2026-07-05 私有资料 RAG 集成 + sourceType 统一 + 边界保护：`npm run test -- --maxWorkers=1`（374 条通过）、`npm run build`、`cargo test`（99 条通过，含 6 条新增边界保护测试）、`python -m pytest`（43 条通过）。
- 2026-07-06 实机长回复滚动 + 资料总结防编造 + 练习题 prompt 修复：`npm run test -- --maxWorkers=1`（437 条通过）、`npm run build` 通过。
- 2026-07-06 对话内资料导入 + 最近资料 RAG 指代：`npm run test -- --maxWorkers=1`（438 条通过）、`npm run build` 通过。
- 2026-07-06 对话内资料上下文管理 MVP：`npm run test -- --maxWorkers=1`（457 条通过）、`npm run build` 通过。

## 2. Tauri 窗口基础验证

启动：

```powershell
npm run tauri:dev
```

验证项：

| 项 | 操作 | 期望 |
| --- | --- | --- |
| 主窗口 | 启动应用 | 窗口打开，无白屏 |
| 主导航 | 查看左侧导航 | 能看到“对话辅导”和“设置”入口 |
| 对话页布局 | 进入对话页 | 会话列表、消息区、输入框都可见 |
| 输入框固定 | 滚动长消息列表 | 输入框和发送按钮仍在底部可操作 |
| 设置页 | 进入设置页 | 本地数据库和 Provider 配置区域可见 |

## 3. 本地数据库验证

在设置页执行：

| 项 | 操作 | 期望 |
| --- | --- | --- |
| 初始化 SQLite | 点击“初始化 SQLite” | 显示数据库路径、migration、`user_version` |
| 本地自检 | 点击“运行本地自检” | `ping` 成功、默认会话存在、消息写读成功、事务回滚成功 |
| Smoke message | 自检后查看会话 | 不应出现 smoke test 消息 |

## 4. Provider 安全验证

在设置页执行：

| 项 | 操作 | 期望 |
| --- | --- | --- |
| 保存 Provider | 填写 Provider 名称、Base URL、模型、API Key 后保存 | API Key 写入系统凭据存储，表单密码框清空 |
| SQLite 非敏感 | 保存后重启/刷新配置 | 能恢复 Base URL 和模型，但不会回填明文 API Key |
| 测试连接 | 点击“测试模型连接” | 使用已保存 `apiKeyRef`，失败时展示结构化错误 |
| 删除 Key | 删除或替换 API Key | SQLite 不保存明文 Key，旧 Key 不应继续被使用 |

### 4.1 Android 用户自带 Provider 网络边界

以下是 AlertTime 手机端契约，桌面端 Provider 与 TeacherAgent 局域网同步仍按各自协议执行：

| 项 | 期望 |
| --- | --- |
| 无认证本地服务 | 用户显式选择“无认证（本地服务）”后，可使用 loopback/RFC1918 的 HTTP 或 HTTPS；请求不含 `Authorization`/`api-key`，且 API Key 为空 |
| 带密钥服务 | Bearer/API Key 只允许 HTTPS；Key 只进入对应 Header，不进入 URL、query、fragment 或 JSON 正文 |
| 公网 HTTP | 所有认证方式均在发请求前拒绝 |
| Android cleartext | app-wide 平台许可仅为动态私网 none HTTP 提供能力；不能代替 `EndpointPolicy`，不能放宽同步 HTTPS 或带密钥模式 |
| URL 与重定向 | credentials、query、fragment、非 `/v1` 根地址拒绝；客户端不跟随重定向 |
| Provider 切换 | 切换到 none 原子删除旧密文；切回带密钥模式必须重新填 Key 或使用仍存在的合法密文 |

上述条目要求手机端自动化契约测试与真实设备验证分别记录；自动化通过不等价于真实 Provider 验收。

日志检查：

- Rust 日志不得包含 API Key、Authorization header、完整请求体、学生消息正文、学生画像或工具原始答案。
- 允许记录 Provider 名称、模型名、脱敏 endpoint host、HTTP 状态、错误 code 和消息数量。

### 4.2 Provider 配置帮助中心

在设置页执行：

| 项 | 操作 | 期望 |
| --- | --- | --- |
| 帮助入口 | 设置页 Provider 区域 | "不知道怎么配置？查看教程"按钮可见 |
| 抽屉打开 | 点击帮助入口 | 抽屉从右侧滑出，显示三个 Guide 标签页 |
| 自动选中 | 已填 Ollama Base URL 后打开抽屉 | 自动选中 Ollama 指南而非默认 Kimi |
| 预设应用 | 点击 Kimi K2.6"应用此预设" | 自动进入新增表单，Provider 名称、Base URL、模型一次性填入 |
| API Key 不变 | 应用任何预设 | API Key 字段不被修改、不清空 |
| 错误诊断 | 连接测试失败后打开抽屉 | 顶部显示匹配的防呆说明和解决步骤 |
| 复制反馈 | 点击官方文档链接的复制按钮 | 显示"已复制"或"复制失败"反馈 |
| 原有功能 | 不使用教程直接配置 | 保存和连接测试功能不回归 |
| 隔离验证 | 对话中搜索"Provider 配置" | 不出现在学生知识库检索结果中 |

## 5. 教学链路验证

### 5.1 未配置 Provider

| 输入 | 期望 |
| --- | --- |
| `什么是极限？` | 提示先去设置页配置模型 |
| `今天我该怎么复习极限与连续？` | 不要求 Provider，返回规则版 PlannerAgent 规划 |

### 5.2 配置 Provider 后

| 输入 | 期望 |
| --- | --- |
| `什么是极限？` | 简短解释 + 一个引导问题，不直接变成百科长文 |
| `直接告诉我答案` | 不直接给最终答案，给 L1/L2 提示 |
| `给我一道夹逼定理练习` | 触发本地题库，只先展示题目和低级提示，不泄露答案 |
| `你给我题目` | 若题库命中，直接展示一题完整题干和一个低级提示，不追加无关通用追问 |
| `帮我复盘这道夹逼定理题` | 允许使用内部答案和步骤，但学生可见回复不暴露内部标签 |
| `这题我把 x=0 代进去，所以是 1` | 识别不定式/误区并追问 |

## 6. 持久化验证

| 项 | 操作 | 期望 |
| --- | --- | --- |
| 会话保存 | 新建会话并发送消息 | 会话出现在左侧列表 |
| 消息恢复 | 重启应用后打开该会话 | 学生消息和导师消息仍存在 |
| 元数据恢复 | 查看 Planner 轮次历史消息 | Planner 信号面板仍可展示 |
| 学习记忆 | 完成一轮真实对话 | 反思记录、短期记忆或长期记忆不阻塞对话；SQLite 可用时应保存 |
| 掌握度 | 涉及已知知识点的轮次 | `student_knowledge` 可更新基础掌握度 |

## 6.5 私有资料 RAG 验证

| 项 | 操作 | 期望 |
| --- | --- | --- |
| 导入私有资料 | 在设置页导入一个 PDF 并确认导入 | 文档出现在已导入列表 |
| 对话内导入 | 在对话页点击输入框旁附件按钮，选择 PDF/DOCX/XLSX | 本地解析并保存到 private draft，导师提示已导入，不上传云端 |
| 对话内误导入撤销 | 对话页导入资料后、继续提问前点击状态条里的”移除” | 文档从本地 SQLite hard delete，当前会话最近资料引用清空，后续不再检索该资料 |
| 资料上下文面板 | 点击状态条”管理资料”按钮 | 弹出资料上下文面板，显示当前资料标题和已导入资料列表 |
| 选择已有资料 | 在资料面板中点击一份已导入资料 | 状态条更新为”当前资料：《...》”，recentPrivateDocument 生效 |
| 本轮不用 | 在资料面板中点击”本轮不用” | 状态条提示”本轮已不再使用该资料”，资料仍保留在本地资料库中，不调用 delete |
| 删除资料 | 在资料面板中点击”删除资料”并确认 | 文档从 SQLite hard delete，如果删除的是当前资料则 recentPrivateDocument 清空，状态条更新 |
| 资料面板关闭 | 点击面板关闭按钮或选择资料后面板自动关闭 | 面板收起，不影响当前对话状态 |
| 私有资料检索 | 对话中提问与导入资料相关的问题 | 检索结果包含私有资料内容，sourceType 为 private_document |
| 最近资料指代 | 对话内刚导入资料后输入 `帮我总结这份资料` | ToolAgent 优先读取最近导入文档 chunks，回复基于该资料而非通用学科框架 |
| 来源区分 | 查看 prompt 中的知识上下文 | built-in Pack 和私有资料节点都标记了来源 |
| 引用表达 | 对话中引用私有资料 | 使用"你的资料中提到..."等表达，不伪装成公共知识 |
| 路径隐藏 | 检查对话回复 | 不暴露本地文件路径 |
| 删除后不检索 | 删除私有资料后再提问相同问题 | 不再返回已删除资料的内容 |
| 未导入时不受影响 | 不导入任何私有资料时提问 | built-in Pack 检索正常工作 |
| 资料指代防编造 | 未导入/未命中资料时输入 `帮我总结这份资料` | 不用通用学科框架冒充资料内容；提示未检索到对应资料并要求导入/选择/补充片段 |

## 6.6 设置页已导入资料管理验证

| 项 | 操作 | 期望 |
| --- | --- | --- |
| 设置页删除按钮 | 查看已导入资料列表每条右侧 | 每条有可见文字"删除"按钮，不是纯图标 |
| 设置页删除确认 | 点击"删除"按钮 | 弹出确认框，文案为"从本地资料库删除？会删除文本和分块，不可恢复。" |
| 设置页删除成功 | 确认删除后 | 该条从列表消失，列表自动刷新 |
| 设置页删除失败 | 模拟删除失败（如数据库锁定） | 列表保留不变，页面显示红色错误提示"删除失败：…" |
| 设置页删除后对话不检索 | 在设置页删除资料后回到对话页提问 | 不再返回已删除资料的内容 |

## 6.7 会话级资料绑定持久化验证

| 项 | 操作 | 期望 |
| --- | --- | --- |
| 选择资料后持久化 | 会话 A 中选择资料 X，重启应用打开会话 A | 状态条恢复"当前资料：《X》" |
| 切换会话不继承 | 会话 A 绑定资料 X，切换到会话 B | 会话 B 状态条无资料绑定 |
| 切回会话恢复 | 从会话 B 切回会话 A | 状态条恢复"当前资料：《X》" |
| 本轮不用清空绑定 | 会话 A 点"本轮不用"，重启后打开会话 A | 不再绑定资料 X |
| 删除资料清理绑定 | 删除资料 X 后打开会话 A | 不再恢复 X，状态条无资料 |
| 删除资料后不检索 | 删除资料 X 后在会话 A 问"这份资料" | 不继续引用已删除资料，提示需要导入 |
| 对话内导入后绑定 | 对话页导入资料 Y，重启后打开该会话 | 状态条恢复"当前资料：《Y》" |

## 7. Guardrail 验证

| 风险 | 样例 | 期望 |
| --- | --- | --- |
| 过早答案 | `The answer is C.` | 规则护栏拦截或要求重写 |
| 完整解法过早暴露 | 未进入复盘时直接输出完整步骤 | Guardrail 拦截或降级提示 |
| 内部标签泄露 | `answer_for_internal_review_only: ...` | Guardrail 拦截 |
| 隐私索取 | `Paste your API key` | Guardrail 拦截 |
| 羞辱语气 | `You're stupid` | Guardrail 拦截 |

## 7.5 Document Worker Sidecar 验证

| 项 | 操作 | 期望 |
| --- | --- | --- |
| PyInstaller 打包 | `cd tools/document-worker && .\build.ps1` | 生成 `dist/document-worker.exe`，exe 可执行 |
| Sidecar 复制 | `.\copy-sidecar.ps1` | 复制到 `src-tauri/binaries/document-worker-x86_64-pc-windows-msvc.exe` |
| 开发期 exe 调用 | 放置 exe 后 `npm run tauri:dev`，导入 PDF | Rust 日志显示走 sidecar 路径，解析成功 |
| 开发期 Python 回退 | 删除 exe 后 `npm run tauri:dev`，导入 PDF | 自动回退到 Python 模块，解析成功 |
| 无 Python 无 exe | 两者都不存在时导入 PDF | 返回清晰错误信息，不静默失败 |

## 7.6 孤立节点清理 + 性能优化验证

| 项 | 操作 | 期望 |
| --- | --- | --- |
| 健康检查返回孤立详情 | 设置页点击"健康检查"，存在孤立节点时 | 显示孤立节点列表（ID、标题、学科、review_status） |
| 清理孤立节点 | 点击"清理孤立知识节点"按钮 | 弹出确认对话框，显示将删除的节点列表 |
| 清理确认后执行 | 确认清理 | 节点删除，显示"删除 X 个节点"结果 |
| 清理后 DB 节点数 | 清理后查看知识库管理 | DB 节点数与 Pack 预期一致 |
| 私有资料不受影响 | 清理后检查已导入资料列表 | 私有资料仍存在 |
| 对话记录不受影响 | 清理后查看历史对话 | 对话消息仍存在 |
| 设置→知识图谱切页 | 从设置页切换到知识图谱页 | 页面快速渲染首屏，无明显卡顿 |
| 知识图谱数据加载 | 切换到知识图谱页后等待 | 数据异步加载完成，图谱/列表正常显示 |

## 7.7 Seed Embedding 生成与向量检索验证

| 项 | 操作 | 期望 |
| --- | --- | --- |
| Embedding 按钮可见 | 设置页 → 知识库管理 | "生成全库 Embedding"按钮和模型名输入框可见 |
| Ollama 模型检测 | 已安装并启动 Ollama，执行过 `ollama pull bge-m3` 后进入设置页 | 设置页显示检测到 `bge-m3`，并在默认模型为空或仍为 `text-embedding-3-small` 时自动填入 `bge-m3` |
| 无 Provider 时禁用 | 未配置 LLM Provider 时点击按钮 | 提示需要配置 Provider |
| 生成进度 | 配置 Provider 后点击"生成全库 Embedding" | 显示进度条 x/N，完成后显示存储/失败计数 |
| 生成后计数 | 完成后查看"已嵌入"计数 | 显示已存储的 embedding 数量 |
| 对话向量检索 | 生成 embedding 后在对话中提问 | ToolAgent 优先使用向量搜索，匹配结果 score > 0.1 |
| 降级验证 | 删除 embedding 后提问 | 自动降级到 keyword 搜索，不崩溃 |
| 重复生成 | 再次点击"生成全库 Embedding" | 覆盖已有 embedding（upsert），不产生重复 |
| 404 预检 | Provider 不支持 Embedding 时点击生成 | 不开始批量写入，显示"当前 Provider 不支持 Embedding 接口"，提示 keyword 检索仍可用 |
| keyword 降级 | Embedding 失败后在对话中提问 | ToolAgent 自动降级到 keyword 搜索，正常返回结果 |

## 8. 通过/失败记录格式

建议每轮人工验证后在 `docs/project-status.md` 追加：

```text
- 已执行 verification-checklist 第 X 节：通过/失败。
- 失败项：...
- 证据：命令输出、截图路径或具体复现步骤。
- 后续处理：...
```

## 9. 生产包构建验收（2026-07-07，已过期）

> **注意**：此安装包（7 月 7 日构建）不包含 7 月 9-10 日的 code-runner、timeout clamp 和相关修复。已被下方 9.1 替代。

### 自动验证结果（历史）

| 验证项 | 结果 |
|--------|------|
| `npm run test -- --maxWorkers=1` | 650 passed |
| `npm run build` | 通过 |
| `cargo fmt -- --check` | 通过 |
| `cargo check` | 0 warning |
| `cargo test` | 123 passed |

## 9.1 生产包构建验收（2026-07-10，当前）

### 自动验证结果

| 验证项 | 结果 |
|--------|------|
| `npm run test -- --maxWorkers=1` | 850 passed（41 文件） |
| `npm run build` | 通过（4.1s，主 bundle 474 kB < 500 kB 阈值） |
| `cargo fmt -- --check` | 通过 |
| `cargo check` | 0 warning |
| `cargo test` | 132 passed |

### 生产安装包

- 路径：`src-tauri\target\release\bundle\nsis\TeacherAgent_0.1.0_x64-setup.exe`
- 大小：80.3 MB
- 打包方式：NSIS + MSI
- 构建时间：2026-07-10

### Sidecar 验证

- `code-worker-x86_64-pc-windows-msvc.exe`（7.8 MB）存在于 `src-tauri/binaries/`
- `document-worker-x86_64-pc-windows-msvc.exe`（66.1 MB）存在于 `src-tauri/binaries/`

### 实机回归待验证清单

以下项目需用户安装生产包后手动验证：

- [ ] A. 首次启动：App 能打开，SQLite 已连接，无白屏
- [ ] B. Provider：保存配置、测试连接、普通对话、流式输出
- [ ] C. 对话页：新建/切换/归档/删除、答对闭环、管理资料
- [ ] D. 新增 4 学科：管理类联考、教育学312、心理学312、法律硕士 — 欢迎语、出题、风格
- [ ] E. 知识库管理：41 pack / 723 nodes / 726 questions、健康检查
- [ ] F. 知识图谱：4 个新增学科图谱打开、切换正常
- [ ] G. 练习：4 个新增学科出题、答题、掌握度更新
- [ ] H. 仪表盘：冷启动 50% 显示为初始估计
- [ ] I. 私有资料：上传 PDF、提问、删除
- [ ] J. document-worker：生产包内无 Python 也能解析
- [ ] K. Embedding：不支持时显示友好错误

## 10. 知识天赋树节点交互闭环验收（2026-07-08 新增）

- [ ] 未学习节点不显示"50% · 学习中"，显示"未开始/待学习"
- [ ] 点击列表节点有详情面板弹出
- [ ] 点击图谱节点有详情面板弹出
- [ ] 节点详情面板显示：中文标题、摘要、学科、Pack 名、前置知识（中文）、掌握度
- [ ] 冷启动节点详情不展示 50% 数值，显示“系统内部先验不会作为进度展示”
- [ ] `mastery=0.5 + correctCount=0` 的 unknown 历史记录显示“待评估”，不进入“发展中”
- [ ] 图谱节点中心显示状态图标：`✓` / `↗` / `!` / `◇`
- [ ] "让导师讲解"按钮跳转到对话页并带入知识点名称
- [ ] "出一道练习"按钮跳转到对话页并带入知识点名称
- [ ] 前置知识显示中文标题（不显示裸 ID）
- [ ] 仪表盘掌握度分布不包含冷启动记录
- [ ] 仪表盘整体掌握度只计算有真实学习记录的节点

## 11. 当前优先级

1. 用户实机验证 5 个页面 + 配置 Provider 测试真实对话。
2. 验证练习模块：提交答案后掌握度是否更新。
3. Seed embedding 生成 + 向量检索真实链路。
4. Ollama 集成（需用户安装）。

## 12. 自建学科资料库生成验收（2026-07-08 新增）

- [ ] 多关键词输入如 `机器学习，深度学习，贪心算法` 时，系统按每个关键词分别搜索并显示各主题覆盖数量。
- [ ] 搜索结果自动去重，默认按主题均衡预选来源，而不是只选最后一个高命中主题。
- [ ] 进入来源选择页时，每条来源显示所属主题标签。
- [ ] 配置可用 LLM Provider 后，生成知识库前会基于用户确认的来源生成主题化归纳节点。
- [ ] 未配置可用 LLM Provider 时，生成流程降级为搜索摘要 + topic overview draft，不应只生成单一主题来源。
- [ ] 所有自建学科内容保持 `draft` 状态，来源必须来自用户确认的搜索结果或由确认来源综合生成。

## 13. 2026-07-25 实机回归

- [ ] 已有向量库打开知识库设置页时，显示实际模型及“知识节点 + 题目”总数，不自动发起生成。
- [ ] 已有向量再次点击生成时出现二次确认；取消后不调用 Embedding Provider。
- [ ] 旧全量向量（大于 approved 目标）显示“需收敛”，完成生成后收敛到 approved 目标。
- [ ] Kimi `https://api.moonshot.cn/v1` + `kimi-k2.6` 测试连接成功，不再返回 `invalid temperature`。
- [ ] Kimi 连接测试不再出现 HTTP 200 但 `assistant.content` 为空；请求保留 `thinking: enabled`，健康检查及正式请求的 `maxTokens` 下限为 32768。
- [ ] 使用真实 Tauri IPC 执行 `bge-m3` 知识检索，导师消息显示 `知识库：向量命中 N 条 · bge-m3 · topScore 0.xx`；不得因 `VectorSearchResult` 字段命名不匹配降级为关键词。
- [ ] Embedding 页面明确显示一次生成所有学科的 approved 内容；当前正式目标为 145 个知识节点 + 123 道题 = 268 条，40 个 draft Pack 不进入正式向量库。
- [ ] 当前学科点击“启用全部（含待审核）”后，所有 Pack 复选框立即选中；“恢复默认”后仅 approved Pack 启用。

## 14. 2026-07-30 安全修复回归

自动验证：

```powershell
cd tools/code-worker
python -m pytest tests/ -v
cd ..\..
npm run test -- --run
npm run build
cd src-tauri
cargo fmt --check
cargo check
cargo test
```

- [x] Release / 默认 Debug 下调用 `run_code` 返回“当前环境未启用安全隔离”，且不启动 worker。
- [x] 仅 Debug 同时设置 `TEACHER_AGENT_ENABLE_TRUSTED_CODE_RUNNER=1` 和 `VITE_ENABLE_TRUSTED_CODE_RUNNER=1` 时，可信本地代码入口可用；UI 明示非安全沙箱。
- [x] `object.__subclasses__()`、恢复真实 builtins、文件、网络、子进程样例在未授权模式下均不启动子进程。
- [x] code-worker 命令行只有固定动作名，学生代码与 stdin 只走 stdin。
- [x] worker 环境不包含 Provider Key、代理、云凭据、SSH 凭据、数据库连接串和用户自定义秘密。
- [x] code-worker 执行子进程不继承 `PATH`；wrapper 使用单次占位符渲染，用户代码或 stdin 中的占位符文本不会被二次替换。
- [x] 未实现 OS 级内存隔离时，`memoryLimitMb` / `memory_limit_mb` 明确返回结构化错误，不再静默接受无效安全参数。
- [x] document-worker 可执行文件与 Python 回退均先清空环境，仅恢复系统根目录、临时目录和固定 Python 编码变量；不继承 `PATH`、Provider Key 或代理。
- [x] `compute_math_with_worker` 在启动 SymPy 前校验 operation、变量名、表达式长度、字符/标识符集合、token 数、括号深度与配平。
- [x] code-worker 的 stderr/error/warnings 在 Rust IPC 边界移除 ANSI/控制字符、绝对路径和常见凭据形态；仍保留 Python 错误类型与行号供教学反馈。
- [x] `looks_like_plain_api_key` 覆盖 OpenAI/Anthropic、Groq、Google、Hugging Face、GitHub、Slack、Stripe、AWS、OAuth/JWT 常见形态；Authorization/Bearer 头不会遗留下一 token。
- [x] 文档选择结果的 `filePath` 兼容字段实际为 64 位一次性令牌，不包含绝对路径；任意路径、`..`、UNC、设备路径、敏感目录、非法扩展名、超 50MB 和授权后替换均被拒绝。
- [x] Provider 远程 HTTP、缺失 scheme、URL 用户名密码、query/fragment 和 loopback 之外的本地地址被拒绝。
- [x] Provider HTTP 客户端不跟随 3xx；endpoint 改变或 SQLite 篡改后，旧 Key 在请求发出前被绑定校验拒绝。
- [x] 旧未绑定 keychain 值和非法 `api_key_ref` 不迁移、不静默接受，提示重新录入。
- [x] Markdown 清洗覆盖 script、SVG、事件属性、`javascript:`、iframe/object/embed，同时保留安全链接、代码块和 KaTeX。
- [x] Release 缺失/错误 sidecar manifest 均拒绝；Debug 仅 `TEACHER_AGENT_ALLOW_UNVERIFIED_SIDECARS=1` 可绕过，且配套 `VITE_ALLOW_UNVERIFIED_SIDECARS=1` 显示全局警告。
- [x] `npm run tauri:build` 在前端构建前自动执行 `npm run sidecar:hashes`，安装包内 manifest 与实际 sidecar hash 一致。

自动验证记录（2026-07-30）：

- `tools/code-worker: python -m pytest tests/ -v`：68 passed（3 个既有 pytest collection warnings）。
- `tools/document-worker: python -m pytest tests/ -v`：43 passed。
- `npm run test -- --run`：53 files / 1116 tests passed。
- `npm run build`：通过，主 bundle 473.25 kB。
- `cargo fmt --check`、`cargo check`：通过。
- `cargo test`：201 passed；`cargo test worker::tests`：34 passed；`cargo test shared::tests`：15 passed；`cargo test code_worker::tests`：11 passed。
- `npm run test -- --run src/services/tools/codeRunner.test.ts`：10 passed。
- `cargo test --release code_worker::tests`：10 passed。
- `cargo test --release sidecar_integrity::tests`：5 passed。
- 最终 sidecar smoke：默认未授权模式按预期返回 exit 1 且未执行 `print(42)`；显式可信开发模式返回 exit 0 / stdout `42`；`memoryLimitMb` 返回结构化拒绝；用户代码内占位符文本保持原样。
- code-worker SHA-256：`95c1522c668b9db98fe1d9847f56d73352c042caae39749c82854b50e7ed1487`。
- `npm run tauri:build`：通过，生成 MSI 与 NSIS 安装包。
- `scripts/release-check.ps1`：8/8 全部通过，manifest 共 2 项且与 release sidecar 哈希一致。

以上勾选表示代码路径与自动化/发布产物验证通过，不代替 Windows 目标机上的交互式 UI、Keychain、网络代理和安装升级验收。

## 15. 考试体系（ExamTaxonomy）验收（2026-08-07 新增）

自动验证（本分支已执行）：

- `npm run test`：59 files / 1203 tests passed（含 examTaxonomy 3 个测试文件 51 条）。
- `npm run build`：通过，主 bundle 473.78 kB。
- `cargo test`：242 passed（含 sync::protocol / sync::db exam 字段测试）。
- AlertTime `testDebugUnitTest`：sync 相关 30 条通过（SyncCodecTest exam 字段 + SubjectExamTagStoreTest）。
- AlertTime `lintDebug` / `assembleDebug`：通过（见执行记录）。

功能验收清单：

- [ ] 分类 Registry：目录校验通过（叶子有合法父级、EXAM_TRACK 无 questionScope、pack 引用真实存在）；408 四门子科目与别名映射正确；考研英语作为另一真实考试组同样验证；用户自定义/未知/模糊科目不被错误映射。
- [ ] 今日计划驱动：今日计划=计算机网络只返回网络题；今日计划=操作系统不出现网络/数据结构/组成原理题；今日计划=408 无子科目时必须要求选择或进入综合复习（显示当前子科目）；无今日计划不伪称依据；日期/完成状态/时长正确进入推荐上下文。
- [ ] 题目归属与校验：只允许 approved 叶子范围题目进入结果；只有考试组标签的题目被拒绝；跨考试组、跨科目混入被拒绝；题目显示「本题属于：考试组 / 课程 / 模块」与推荐依据。
- [ ] 同步兼容：旧快照（无 exam 字段）可读；旧 JSON 备份可读；未映射历史数据保留不乱归类；sync_* 运行时状态不进入备份；A+B 合并恢复语义不回退。
- [ ] UI：练习页考试组→课程→模块选择器 + 综合复习入口 + 今日计划映射状态；同步页映射按考试组分组、显示已映射/待确认/未映射与建议；映射可编辑、可撤销；AlertTime「Teacher 同步」可编辑可选考试体系标签，不阻断原有功能。
- [ ] 掌握度边界：学习时长只影响投入度/难度推荐，不直接更新掌握度；未答题不更新 mastery。

实机验收（需设备）：

- [ ] 手机同步 → 练习页今日计划=计算机网络只出网络题，依据文案显示「根据你今天的『计算机网络』计划与学习记录生成」。
- [ ] 手机同步 → 今日计划=408 时练习页要求选择子科目或进入综合复习；综合模式显示当前实际子科目。
- [ ] 映射修正与撤销：修改/移除映射后出题范围立即变化；「待确认」科目确认后进入 mapped。
- [ ] AlertTime 设置考试体系标签后同步，TeacherAgent 映射区显示「手机端声明，待确认」。
- [ ] 旧版手机端（不发送 exam 字段）同步仍成功，映射与诊断不受影响。

## 15.5 考试体系审查修复回归（2026-08-07）

- [x] P1 approved 门禁白名单化：`isPackApproved` 以 PACK_MANIFEST.status === "approved" 为权威（不依赖 seed JSON 黑名单）；`validateQuestionScope` 门禁顺序 = Manifest approved → 归属匹配 → 叶子 approved；`filterSeedsToScope` 对 Manifest 非 approved 的 pack 直接过滤（伪造 seed status 也无法绕过）。
- [x] P1/P2 共享 Pack 归属：`attributedQuestion` 接收当前请求范围匹配到的 attribution（不再取第一条）；测试覆盖「pack approved 但归属不匹配 → 拒绝」与「结果 attribution 与请求叶子一致」。
- [x] P2 综合复习文案动态化：按实际参与轮换的课程数显示（如「1 门课程轮换」「4 门课程轮换」），不再写死「四门轮换」。
- [x] P2 moduleId 推导：叶子为 MODULE 返回自身、SUBJECT 返回 null（`deriveModuleId` 纯函数 + 三层路径测试，确保不会把父级 Subject 赋值为 moduleId）。
- [x] 目录漂移检测：`validateCatalog` 新增叶子状态与 Pack Manifest 状态一致性检查（approved 叶子必须对应 approved pack；draft 叶子不得包装 approved pack）。
- [x] 回归：`npm run test` 1213 条（examTaxonomy 61 条）通过；`npm run build` 通过；`cargo test` 244 条通过。

## 15.6 AlertTime 诊断证据数据库权威重建（2026-08-11）

自动验证：

- [x] `submitPracticeAnswer` 的普通 PracticeView 不传 provenance；AlertTime `answerDiagnostic` 传入 `origin=alerttime_sync_diagnostic_v1`、`questionId`、`alertSubjectRemoteId` 和考试叶子字段，并写入现有 `assessment_results.evidence_json`。
- [x] 新 typed read command 通过参数化 `assessment_results JOIN subjects` 读取；`teacherSubjectId`、`correct`、`createdAt` 均来自 DB，localStorage 只提供候选 assessment ID。
- [x] 普通 practice、损坏 JSON、缺 questionId/correctness、非法 provenance、超限/重复 ID 均 fail-closed 或跳过；错误不回显 evidence 内容。
- [x] 新 provenance 与同一 JSON 的 nested evidence 做题号、正确性和考试归属一致性校验；任一 mismatch 丢弃整行。
- [x] localStorage 篡改计数/归属不生效；同一 cached batch 内重复 assessment ID 不放大题数或正确数；DB `created_at` 无法解析时不进入重建结果。
- [x] 历史 `diag-*` 无 remoteId 记录仅在当前 teacherSubject 唯一 mapping 下兼容；有历史 scope 时必须精确匹配当前考试叶子，mapping 改指或多 mapping 均拒绝。
- [x] proposal `sourceAssessmentIds` 只能来自 DB 权威重建结果；现有 mapping/考试叶子 gate 保持不弱化。
- [x] 无 migration；Rust assessment 定向测试、前端诊断/重建/wrapper 定向测试、`cargo fmt --check`、TypeScript noEmit/build 和 `git diff --check` 纳入本轮验证。

## 16. 窗口状态 / 生命周期 / AI 使用时间验收（2026-08-07 新增）

自动验证（本分支已执行）：

- AlertTime `testDebugUnitTest`：155 条通过（含 WindowStateTest 11 条、TimerManagerAiHelpTest 7 条、StudyTimeCompositionTest 6 条、SyncCodecTest AI 字段、ExternalAiUsageReaderTest 4 条）。
- AlertTime `lintDebug` / `assembleDebug` / `assembleDebugAndroidTest`：通过。
- TeacherAgent `npm run test`（1203 条）/ `npm run build` / `cargo test`（244 条）/ `cargo fmt --check`：通过。

功能验收清单：

- [ ] 窗口状态分类：普通全屏 / 分屏 / 画中画 / 后台 / 锁屏 / 外部悬浮窗未知 六类；自身窗口状态由 MainActivity 回调（onPictureInPictureModeChanged / onMultiWindowModeChanged / onConfigurationChanged）写入 WindowStateHolder，首页显示「窗口状态」徽标。
- [ ] 生命周期：ON_STOP 在画中画/分屏时不暂停、不记分心、AI 时段继续计时；锁屏时暂停但不记分心；只有真正后台才记分心；旋转/配置变化（manifest configChanges）不产生假 ON_STOP。
- [ ] AI 使用时间：AI_HELP_STARTED（=8）/ AI_HELP_ENDED（=9）显式成对事件；重复开始/结束幂等；锁屏/后台/异常退出安全截断不无限增长；跨日分割正确；完成会话时 aiHelpSeconds 写回 study_sessions；首页显示「AI 求助中…」状态。
- [ ] 同步：SyncStudySessionDto 携带 aiHelpSeconds / aiHelpCount / externalAiAppSeconds / aiUsageSource；旧客户端缺失字段兼容；AI 字段不覆盖 durationSeconds/focusScore/pauseSeconds；备份 JSON（v4）可恢复到 v5 应用（ai_help_seconds 默认 0）。
- [ ] TeacherAgent 报告：区分总学习时间 / 有效专注时间 / AI 求助时间 / 外部 AI App 时间；缺失显示「未记录」不推断为 0；会话明细可查看专注 / AI / 外部 AI。
- [ ] 权限降级：无 Usage Access 时显示「无法判断其他应用是否处于悬浮窗」，不阻断计时、备份与普通学习功能；未提供 Accessibility 服务（本项目未实现，UI 如实说明）。

实机验收（需设备）：

- [ ] 学习计时中进入画中画（Home 上滑/系统 PIP 手势）：计时继续、不分心、无 AI 中断；恢复全屏不重复创建事件。
- [ ] 分屏学习中切到分屏模式：同上；退出分屏恢复。
- [ ] 学习中锁屏再解锁：计时暂停（锁屏不计分心），解锁后自动继续。
- [ ] 学习中按 Home 键（真后台）：记一次分心并暂停；回来自动恢复。
- [ ] AI 求助（Gemini/ChatGPT）：点按钮显示「AI 求助中…」；返回后 AI 时长累计正确；完成会话后统计页 AI 时长与首页一致。
- [ ] 授权使用情况访问后同步：TeacherAgent 周报显示外部 AI App 时长与来源；未授权时显示「未记录」。

## 17. AlertTime 计划评估 / 学习画像 / 评估测试同步验收（2026-08-09 新增）

自动验证（本分支已执行）：

- [x] TeacherAgent `npm run test`：61 files / 1248 tests passed（补充跨周测试时钟、重复分析标识与 100 条 profile 协议上限回归，避免系统日期进入下一自然周后夹具失效或语义损坏/合法上限分析无法展示）。
- [x] TeacherAgent `npm run build`：通过，主 bundle 473.78 kB。
- [x] TeacherAgent `cargo test`：256 tests passed；`cargo fmt --check`：通过。
- [x] AlertTime `testDebugUnitTest`：33 suites / 215 tests passed，0 failure / 0 error / 0 skipped（含用户学习上下文、独立生成、本地持久化与证据索引重载、新安装空 Provider 配置、无默认 Provider、用户 Base URL/模型/Bearer/API-Key 的真实 OkHttp 请求契约与错误脱敏、今日/本周范围、本地任务引用映射、跨午夜会话分摊、证据绑定、可选 UsageStats 异常降级、表单并发门禁、跨 Repository 生成互斥、部分同步提示与 Provider 跨午夜单时刻测试）。
- [x] AlertTime `lintDebug` / `assembleDebug` / `assembleDebugAndroidTest`：通过；lint 0 errors（11 warnings 均未阻断构建）。
- [x] 双端 `sync/protocol` 共 10 个文件逐文件 SHA-256 一致；旧快照缺少 `learningAnalysis` 时仍可读取。

协议与生成边界：

- [x] 每次手机主动同步都先固定 `snapshotId`，再生成 `learningAnalysis`；`sourceSnapshotId` 必须与本次快照一致。
- [x] Provider 关闭、网络失败、超时或模型输出不合法时，使用确定性本地回退，不能阻断原有同步。
- [x] 学习画像严格区分事实与推断；推断携带置信度和证据引用；学习时长只表示投入度/计划执行，不直接更新掌握度。
- [x] 计划评估输出 `reasonable` / `needs_adjustment` / `insufficient_data`、分项评价、风险与建议；TeacherAgent 只展示建议，不自动改写手机计划。
- [x] 评估测试固定为 `draft`，仅生成概念检查/诊断/反思题干、理由与评分要点；禁止答案、解法与解析进入同步协议。
- [x] TeacherAgent 将同步侧分析作为不可信派生数据单独保存和展示，不写入 approved 题库、正式答题结果或掌握度。
- [x] Android Provider 密钥只存 Android Keystore；UI、AppSetting、日志、同步 JSON、备份 JSON 均不保存明文密钥。
- [x] 云端请求采用最小上下文：计划/周目标标题与成功标准、完成状态、时间聚合、学科标签；不发送日记、会话备注、设备 ID、远端 UUID 或本地主键。
- [x] 恢复备份时拒绝 `learning_analysis_llm_*` 设备敏感设置；旧备份与旧同步客户端保持兼容。
- [x] 新安装时 Provider Base URL、模型、学习目的、考试名称、考试科目与目标日期均为空；应用不内嵌可用默认 Provider、模型或公共 Key。
- [x] 空 AppSetting 数据库的直接回归确认 Provider 摘要为禁用、Base URL/模型为空、无可用 Key，且数据层不能加载出可请求配置；默认认证选项不等于内嵌服务商。
- [x] “学习分析与模型设置”与 Teacher 配对/同步界面分离；未配对、桌面离线时可在手机主动生成并持久化最近分析。
- [x] 独立设置入口 Compose instrumentation 不包含配对状态输入，验证“无需连接 TeacherAgent”和“应用不内置默认 Provider”提示可见，且未配置 Provider 时仍可点击“在手机生成学习分析”进入本地规则路径；已编译进 androidTest APK。
- [x] 用户填写的学习目的、考试/项目、考试或重点科目、目标日期作为 `learnerContext` 写入 v2 Prompt，同时进入不可被模型覆盖的本地事实画像；缺失字段不猜测。
- [x] 每次实际同步仍生成绑定本次 `snapshotId` 的新分析，并在首个 TeacherAgent 网络请求前保存到手机；连接失败不会丢失已生成结果。
- [x] 协调器级回归模拟首个桌面请求失败，断言 `saveLatest` 已先完成、网络错误仍向调用方返回，且不会继续到成功时间写入路径。
- [x] Android 分析生成只读取一次注入时钟；本地日期范围、LLM 输入、LLM 成功结果和 deterministic fallback 共用同一手机时区与 `generatedAt`，Provider 响应跨过午夜也不会导致证据范围和结果时间不一致。
- [x] LLM Prompt 仅包含手机本地“今日计划、当前周目标、今日完成会话”；模型只返回 `sourceTaskIndex`，手机端再映射为真实任务/学科远端 ID，未知证据引用 fail-closed 丢弃。
- [x] Android 单测 fixture 与 canonical `learningAnalysis` 协议副本一致；Kotlin、Rust、JSON Schema 对嵌套非空字符串和字段上限保持一致。
- [x] Kotlin 与 Rust 都拒绝负数 `generatedAt`、空或超过 64 字符的可选 `appVersion`；Teacher 本地派生分析缓存损坏时仅忽略该分析，不影响科目、计划与会话读模型。
- [x] `learning_analysis_runtime_*` 派生缓存和 `learning_analysis_llm_*` Provider 配置均被备份导出/恢复 fail-closed 排除；`learner_context_*` 作为用户普通设置受明文备份隐私提示约束。
- [x] 本轮未引入云端数据库、账号、后台上传或公网同步依赖；TeacherAgent 仍是手动私有局域网消费者。
- [x] 学习目标或 Provider 表单存在未保存草稿时禁止生成；刷新、学习目标保存、Provider 保存/停用和生成共享前台操作门禁，避免生成读取旧设置。
- [x] 可选 UsageStats 读取抛出权限或 OEM 异常时降级为 unknown，不阻断手机独立分析或后续同步。
- [x] 今日完成会话按手机本地自然日重叠范围纳入；跨午夜且缺少暂停事件明细时按重叠比例分摊，并明确 warning；`durationSeconds` 不再重复扣除 `pauseSeconds`。
- [x] `evidenceRefs` 仅允许冻结聚合证据、用户设置证据、当前快照实体 remoteId 或 `task:<当前任务 remoteId>`；Android 上传前与 Rust 入库前均 fail-closed。
- [x] Teacher 读取最近派生分析缓存时重新校验 snapshotId、唯一性、实体引用和证据绑定；语义损坏时只隐藏分析，不影响科目、计划和会话读模型。
- [x] Teacher 前端只读投影与 Kotlin/Rust 协议一致允许最多 100 条事实和 100 条推断，题目与 warning 仍各自维持 50 条上限。
- [x] 桌面建议处理结果部分回传失败时 Android 保留待发项并明确显示“下次同步重试”；快照同步结果不再掩盖该部分失败。
- [x] 配对、解除配对、忘记本地配对与完整同步使用全进程共享互斥，避免 ViewModel 重建或多入口产生并发网络流程。
- [x] 手机独立生成与同步前生成即使来自不同 ViewModel/Repository 实例也共享分析操作互斥；确定性并发测试证明第一项释放前第二项不会构建快照，释放后同步快照最后保存，不会被较旧独立结果覆盖。
- [x] 最近分析缓存只附带被引用实体的 remoteId 证据索引，不复制计划正文、会话备注、Provider 或密钥；重载时用该索引重做正式协议校验。真实 Room 文件库关闭/重开 instrumentation 测试已编译进 androidTest APK。
- [x] OpenAI-compatible 客户端请求契约测试确认：请求 URL 与模型完全来自用户设置；Bearer 与 `api-key` 模式不会互相回退；API Key 不进入 JSON 正文；HTTP 错误只暴露状态码，不回显 Provider 响应正文或密钥。测试使用内存 OkHttp 拦截器，不冒充真实 Provider 联网验收。
- [x] Provider 配置新增真实 Room + Android Keystore instrumentation：使用独立测试数据库和独立测试 alias，验证用户 Base URL、模型与认证方式在 Room 关闭/重开后恢复，AppSetting 只含密文且可重新解密；已编译进 androidTest APK，尚未在设备执行。
- [x] 新增 `scripts/verify-learning-analysis-device.ps1` 定向设备入口：PowerShell AST 解析通过；无设备时在安装前 fail-closed；脚本拒绝新装/多设备，只允许 `adb install -r -t`，仅执行三个隔离测试并核对 package userId/firstInstallTime，不包含卸载、清数据或全量 connectedAndroidTest。
- [x] 无设备跨层回放门禁：Rust 使用 canonical `snapshot-valid.json` 经过真实 `/v1/snapshots` Router 鉴权、校验、SQLite 入库、`snapshotAck` 与 read model 读取，错误 `sourceSnapshotId` 返回 422 且数据库无残留；Teacher 前端从同一 canonical fixture 投影事实、推断、计划评估和 draft 题并覆盖 10 个 fail-closed/边界断言；Android JVM 串联未配置 Provider、`deterministic_fallback`、快照 A/B、新 `analysisId`、共享互斥与最近分析保存。三条路径均不依赖设备、真实网络或生产数据。
- [x] 2026-08-11 自动门禁复跑：Teacher 前端 62 files / 1258 tests，Rust 258 tests，Android 34 suites / 216 tests；Teacher build、Rust fmt、Android lintDebug / assembleDebug / assembleDebugAndroidTest 通过；双端 `sync/protocol` 各 10 个文件 SHA-256 逐项一致。

实机与真实 Provider 验收（待设备执行）：

2026-08-11 无设备回放单命令入口（已由主 Agent 实际复跑）：Windows PowerShell 5.1 AST 解析通过；Node mirror 单测 7 项中 6 passed、1 skipped，跳过原因为 Windows 无符号链接权限且逻辑为明确拒绝；从 TeacherAgent 根目录执行 `npm run verify:alerttime-offline -- -AlertTimeRoot "C:\Users\Acer\Documents\AlertTime-teacheragent-json" -RustToolchainBin "D:\DevEnv\Caches\.rustup\toolchains\stable-x86_64-pc-windows-msvc\bin"` 完整 exit 0。Teacher canonical Vitest 10 passed，Rust `snapshot_route_` 2 passed，Android `LearningAnalysisOfflineReplayTest` JVM 类通过且 Gradle `BUILD SUCCESSFUL`；双端协议 10 files identical。

离线边界与守卫结果：无 ADB、无设备、无安装/卸载/清数据、无 connectedAndroidTest；`local.properties` 未创建或修改，脚本守卫通过；无 rustup 自动修复、无 Git 暂存/提交。该结果不替代 instrumentation、真实 Provider 或局域网手机—桌面真机闭环。

剩余 11 项按 4 个连续批次执行；它们是运行证据门禁，不表示当前仍有已知代码缺口。任一批次失败时，再按失败证据重新打开实现项：

1. **设备安全与隔离测试**：先完成覆盖安装和数据保留确认，再一次性执行 3 个定向 instrumentation（下列第 1、9、10、11 项）。
2. **手机独立与重启持久化**：保持 TeacherAgent 未配对或关闭，填写学习目标并独立生成，重启后核对最近分析（第 4 项）。
3. **局域网确定性闭环**：Provider 关闭，完成 fallback 同步、桌面离线后再同步、数据变化触发新分析，以及 TeacherAgent 只读展示核对（第 2、5、7、8 项）。
4. **真实 Provider 与故障注入**：使用用户自带 OpenAI-compatible Provider，核对最小上传与密钥边界，并覆盖超时、HTTP 错误和非法响应（第 3、6 项）。

- [ ] 使用 AlertTime `scripts/verify-learning-analysis-device.ps1` 的预检与 `-ConfirmReplaceInstall` 路径完成 `adb install -r -t` 覆盖安装；再由用户确认应用数据、配对状态、已有计划与历史专注记录仍保留。不得卸载或清除数据。
- [ ] Provider 关闭时同步成功，TeacherAgent 显示 `deterministic_fallback` 的事实画像、计划评估与评估测试草稿。
- [ ] 配置真实 OpenAI-compatible Provider 后同步成功，抓取请求或服务端审计确认只发送最小字段，且密钥不出现在日志/数据库/备份中。
- [ ] 不配对 TeacherAgent：在手机设置填写“考研 / 2027 考研 / 数学一、英语一、408 / 目标日期”，保存后独立生成；重启 App 后仍能查看同一最近分析，画像事实与草稿题范围包含用户填写内容。
- [ ] 桌面完全关闭时独立生成成功；随后开启桌面并同步，TeacherAgent 收到的是绑定新同步快照的分析，手机最近分析同步更新。
- [ ] 模拟 Provider 超时、HTTP 错误、非法 JSON、越界分数、跨快照引用和含答案题目，确认手机回退且 TeacherAgent fail-closed。
- [ ] 今日计划、周目标与专注记录改变后再次同步，确认生成新的 `analysisId`，建议与证据随真实数据变化，不复用旧分析。
- [ ] TeacherAgent 展示事实/推断/计划合理性/风险/建议/测试草稿，并明确“建议需用户采纳”“草稿不代表正式题库或掌握度”。
- [ ] 在设备执行 `LocalLearningAnalysisStoreInstrumentedTest`，确认真实 Room 文件库关闭并重新打开后仍可读取同一分析；当前仅完成测试 APK 编译，不冒充设备执行通过。
- [ ] 在设备执行 `LlmProviderSettingsStoreInstrumentedTest`，确认真实 Room + Android Keystore 重建后仍能恢复用户 Provider 配置且数据库不含明文 Key；测试使用独立 alias，不触碰用户生产密钥。
- [ ] 在设备执行 `LearningAnalysisDialogTest`，确认未配对、未配置 Provider 时独立设置入口仍可见并可触发手机本地规则生成。

## 17.1 2026-08-11 无设备跨层回放门禁

以下项目可在无 ADB、无设备、无真实 Provider 和无真实网络的条件下执行；它们验证离线代码闭环，不替代设备、真实服务商或局域网实机验收。

### 无设备命令

```powershell
npm run test:protocol-mirror
npm run verify:alerttime-offline -- -AlertTimeRoot "C:\Users\Acer\Documents\AlertTime-teacheragent-json" -RustToolchainBin "D:\DevEnv\Caches\.rustup\toolchains\stable-x86_64-pc-windows-msvc\bin"
```

### 无设备项目

- [x] Windows PowerShell 5.1 AST 解析通过；Node 协议镜像 6 项通过、1 项因符号链接权限 skip，exit 0；双端 `sync/protocol` 各 10 个文件 SHA-256 一致。
- [x] 生产 codec 回放：canonical fixture 通过生产 `SyncCodec.decodeSnapshotEnvelope`，进入 `LearningAnalysisService` / Repository；覆盖软删除、Unicode/emoji、AI 使用字段、今日计划和稳定实体 ID A/B 状态变化。
- [x] 原子 state：`sync_get_device_state` 以单连接、单 SQLite 读事务一致返回 `readModel + lastSnapshot`；store 不再并行调用两个独立 IPC，旧命令仅兼容保留。Pinia store 防回归测试锁定 `loadDevice` 仅调用原子 `getSyncDeviceState`；合法 `analysis.sourceSnapshotId` 与 `lastSnapshot.snapshotId` 一致，report 使用同一 snapshot，两个 legacy 命令均未调用。
- [x] 同毫秒顺序：Rust 覆盖同一 `received_at_ms` / 文本时间下的 A/B 快照，按 `rowid DESC` 选后插入行，不由 UUID 字典序决定；最新快照无分析时不回退旧分析。
- [x] 文件重开与回滚：Rust canonical fixture 真 SQLite 文件关闭/重开、迁移 0012 回填、迁移 0013 从带旧数据的 v12 安全升级且第二次启动幂等、分析冲突整事务回滚均通过；`user_version` 为 13。
- [x] Teacher canonical 投影和 `LearningAnalysisPanel` 真实 SFC SSR：完整渲染、snapshot mismatch、null fallback 3 项通过。
- [x] 今日计划/考试叶子出题：显式选择优先，其次使用今日计划已映射的 approved 叶子；父级、draft、跨归属和空白显式 whitelist 均 fail-closed；叶子 mastery whitelist 覆盖该范围全部 approved knowledge node，不以 topK 检索结果代替。
- [x] 诊断 evidence 权威性：sync diagnostic provenance 进入现有 `assessment_results.evidence_json`；提案前由 Rust SQLite JOIN 权威重建，localStorage 仅能提供候选 ID；重复 ID、普通练习、损坏或漂移 evidence、歧义 legacy mapping 均不能生成有效证据。
- [x] 提案分页与 ACK：Rust 使用 `(created_at_ms, id)` 稳定 keyset；空白、未知或跨设备 cursor 返回 400 `invalid_cursor`。Android 全页校验后一次性合并，重复 ID、cursor 循环、中途失败、超过 100 条均 fail-closed；snapshot/decision ACK 严格绑定原请求。
- [x] 答案泄露门禁：Teacher 同步 schema/Rust 与 Android 生产 codec 在 typed decode 前拒绝 assessment question 的直接答案/解析字段；Android 用户 Provider 输出命中同一门禁时回退本地确定性评估。
- [x] 用户自带 Provider：`none` 不保存、不发送 Key，只允许 HTTPS 或 loopback/RFC1918 HTTP；Bearer/API-Key 强制 HTTPS 和非空 Key。切到 `none` 时同一 Room 事务删除旧密文，OkHttp 禁止重定向；Android app-wide cleartext 仅提供平台能力，`EndpointPolicy` 仍是唯一请求入口。
- [x] 最新自动门禁：Teacher Vitest 69 files / 1309 tests、build main bundle 473.78 kB；Rust 283/283 与 fmt；Android 36 suites / 264 tests、lintDebug（0 errors / 12 warnings）、assembleDebug、assembleDebugAndroidTest 全通过。单命令离线闭环 exit 0；双端协议 10 files identical，Android JVM canonical fixture 8 files identical。

### 仍待设备或真实服务商验收

- [ ] 真实 Provider 请求与故障注入。
- [ ] `none` 模式分别连接 localhost/家庭 WiFi/手机热点上的无认证 OpenAI-compatible 服务；确认私网 HTTP 可用且请求无认证 Header，公网 HTTP 被拒绝。Bearer/API-Key 模式确认仅 HTTPS 可保存和请求，证书错误、重定向、空 Key 均 fail-closed。
- [ ] Android instrumentation（当前仅编译 `assembleDebugAndroidTest`，不视为设备执行）。
- [ ] 进程重启后的 UI / 最近分析展示。
- [ ] 手机—桌面局域网真机配对、同步、proposal 采纳/拒绝、采纳后执行反馈和撤销闭环。
- [ ] 以上项目不得以离线 JVM、Rust SQLite 或 SFC SSR 回放结果代替。

## 17.2 Proposal 采纳执行反馈闭环（2026-08-11）

- [x] Android 仅允许当前用户未删除、未归档的科目被 proposal 任务引用；任一非法引用使采纳事务整体回滚。
- [x] 采纳在单个 Room 事务中创建 `type=1` 的真实计划和真实周目标，同时记录 proposalId 到本地主键的有界、版本化来源映射；崩溃重试与并发点击不重复创建。
- [x] 来源映射损坏、重复或超限时 fail-closed 为“无来源”，不阻断普通快照；备份不导出该 `sync_*` 运行态，恢复或重新配对清除映射但不删除业务数据。
- [x] Android 完整快照为对应周目标/任务增加可选 `sourceProposalId`；旧快照缺失或显式 null 仍可读取，非法 ID 被生产 codec 拒绝。
- [x] Teacher 迁移 0013 用 nullable TEXT 持久化两个来源字段，无 FK、无本地 proposal 准入要求；真实 v12 旧行升级后保留且新列为 null，重复迁移幂等。
- [x] Teacher 执行反馈只接受同设备 `accepted` proposal、合法时间链、字段精确唯一匹配且任务 `type=1`；跨 proposal、字段漂移、重复、软删除、旧客户端缺失来源均不能抬高完成率。
- [x] 完成、待完成、其他终态、软删除和缺失分别统计；完成率分母包含无法追踪项。最近一次可追踪结果进入下一轮建议依据，并阻止重复生成仍待完成的同源任务/周目标。
- [x] canonical snapshot/proposal fixture 在 Rust 与 Android 侧均交叉验证设备、accepted、时间链、字段、任务类型和重复 claim；双端协议 10 文件与 Android JVM fixture 8 文件逐字一致。
- [x] 自动门禁：Teacher 69 files / 1309 tests、Rust 283/283、Android 36 suites / 264 tests，生产构建、lint、APK/test APK、协议镜像与无设备离线跨仓闭环全部通过。
- [ ] 真机：采纳一个建议后检查手机真实计划/周目标，再次同步并在 Teacher 查看待完成/完成变化；本项仍待用户在设备上验收，自动测试不得替代。
