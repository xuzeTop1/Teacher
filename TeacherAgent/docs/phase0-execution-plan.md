# Phase 0 Execution Plan（⚠️ 历史执行记录）

最后更新：2026-07-02
Phase 0 状态：**已完成**

> **⚠️ 本文是 Phase 0 的历史执行记录，不再作为当前执行依据。** 当前阶段、已完成工作和下一步任务以 `docs/project-status.md` 为准。

本文用于承接 `docs/project-status.md` 的”下一步推荐”，把 Phase 0 余下工作拆成可连续执行的小批次。详细验收步骤见 `docs/verification-checklist.md`。

## 当前目标

把 TeacherAgent 的最小可用闭环跑稳：

- 桌面窗口可启动、可导航、可输入。✓
- SQLite 本地数据闭环可验证。✓
- Provider 配置安全可验证。✓
- 未配置 Provider 时，Planner 规则轮次仍可用。✓
- 配置 Provider 后，普通辅导、练习、复盘、Guardrail 均可验证。✓
- 重启后数据持久化可验证。✓

**Phase 0 目标已全部达成！可进入 Phase 1。**

## P0：先恢复可信验证

状态：已通过（2026-07-01）。`cargo fmt`、`cargo check`、`cargo test` 均通过，Rust 测试 10 条通过。

必须先做：

```powershell
cd src-tauri
cargo fmt
cargo check
cargo test
```

原因：

- `conversation.rs` 已从 `lib.rs` 拆出。
- 拆分后当前环境曾因额度限制拦截 `cargo fmt`。
- 在 Rust 验证通过前，不继续扩大 Rust 模块拆分。

通过后记录：

- 已在 `docs/project-status.md` 追加 `conversation.rs` 拆分后的 `cargo fmt/check/test` 结果。
- 如果失败，先修复 Rust 编译或测试，再进入 P1。

## P1：桌面窗口与本地数据库

状态：进行中。`npm run tauri:dev` 已可启动，Tauri 窗口可识别；主导航、对话输入区、Provider 表单、会话标题输入和关键按钮已完成 Tauri WebView 兼容性修复。仍需在窗口内人工点击“初始化 SQLite”和“运行本地自检”记录结果。

执行：

```powershell
npm run tauri:dev
```

验证：

- 主窗口打开。
- 左侧导航可见。
- 对话页输入框固定可用。
- 设置页可打开。
- “初始化 SQLite”成功。
- “运行本地自检”成功，且 smoke message 不污染真实会话。

记录：

- 按 `docs/verification-checklist.md` 第 2、3 节记录通过/失败。

## P2：Provider 安全闭环

状态：已通过（2026-07-02）。MiMo Provider 连接成功（mimo-v2.5-pro，耗时 4728ms）；API Key 写入系统凭据存储，SQLite 只保存 `api_key_ref`；设置页测试连接使用 keychain 引用。

验证：

- 用户手动填写 Provider 名称、Base URL、模型和 API Key。
- 保存后密码框清空。
- SQLite 只保存 `api_key_ref`。
- 设置页重新加载不回填明文 API Key。
- 测试连接使用 keychain 引用。
- 错误日志不包含 API Key、请求体、学生消息或学生画像。

记录：

- 按 `docs/verification-checklist.md` 第 4 节记录证据。

## P3：教学链路闭环

状态：已通过（2026-07-02）。配置 MiMo Provider 后，以下场景均验证通过：

- `什么是极限？` → 简短解释 + 引导问题 ✓
- `直接告诉我答案` → 不直接给最终答案，引导思考 ✓
- `给我一道夹逼定理练习` → 只展示题目和提示，不泄露答案 ✓
- `帮我复盘这道夹逼定理题` → 完整复盘，内部答案不暴露给学生 ✓

已实现 Sentence-Buffered Streaming 优化，首字延迟降低；maxTokens 从 900 放宽至 4096 避免思考截断。

记录：

- 按 `docs/verification-checklist.md` 第 5、7 节记录。

## P4：持久化闭环

状态：已通过（2026-07-02）。会话、消息、学习记忆、长期记忆、短期记忆、学生画像和掌握度更新均已验证。

验证步骤：

### 4.1 会话持久化 ✅
- 新建会话后可在左侧列表看到 ✓
- 切换会话后消息正确加载 ✓

### 4.2 重启后数据保留 ✅
- 关闭 Tauri 窗口后重新启动，会话和消息仍可查看 ✓

### 4.3 Planner 历史面板 ✅
- 规划信号面板显示掌握度、前置依赖和复习信号 ✓
- 面板为信息展示型，无需点击交互 ✓

### 4.4 学习记忆持久化 ✅
- 长期记忆: 6 条记录已保存到 SQLite
- 短期记忆: 4 条记录已保存到 SQLite
- 学生画像: 1 条记录已保存到 SQLite

### 4.5 掌握度更新 ✅
- `student_knowledge` 表有 16 条记录
- 掌握度概率、尝试次数、正确次数均在更新

记录：

- 按 `docs/verification-checklist.md` 第 6 节记录。

## P5：通过后再继续开发

状态：大部分已完成。P0-P4 已全部通过。以下任务的当前状态：

1. ~~拆 `memory.rs`~~：已完成。
2. ~~拆 `assessment.rs`~~：已完成。
3. ~~拆 `knowledge.rs`~~：已完成。
4. 接入 SQLite-vec：待网络恢复后添加 crate。
5. ~~扩展章节级 DAG Planner~~：已完成（拓扑排序、关键路径）。
6. ~~数学计算引擎~~：已实现纯 Rust 符号计算（求导、积分、求值、化简、极限、方程求解）。
7. ~~IPC memory 调用~~：已恢复（带超时降级）。
8. ~~Phase 1 本地 RAG~~：已完成。53 个知识节点已入库 SQLite `knowledge_nodes` 表，ToolAgent 优先查数据库 keyword 搜索，降级到 JSON seed；中文自然句搜索命中率已提升。

## 当前不要做

- 不继续扩大 Rust 拆分，直到 P0 通过。
- 不接入 web_search，直到本地知识库和隐私策略验证完成。
- 不引入云账号、多端同步或远程学生画像。
- 不导入版权不明的题库或教材内容。
- 不把 API Key 明文写入 SQLite、前端全局 store、日志或普通文件。
