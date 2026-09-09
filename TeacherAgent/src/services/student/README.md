# Student Services

学生相关 service 放在这里，包括短期记忆、长期记忆、用户画像、掌握度和后续评估结果访问。

当前 Phase 0 已落地：

- `memoryService.ts`：SQLite 优先、本地兜底的学习记忆服务。
  - 短期记忆：当前会话摘要、近期关注点、待跟进问题、最近误区。
  - 长期记忆：学习目标、讲解偏好、误区、策略信号和情绪信号的脱敏摘要。
  - 用户画像：按学生和学科聚合的认知画像候选项。

实现边界：

- Phase 0 优先通过 Tauri command 读写 SQLite：`student_cognitive_profiles`、`long_term_memories`、`short_term_memories`。
- 浏览器预览、Tauri IPC 不可用或 SQLite 写入失败时，自动回退到 `localStorage`，保证开发体验不中断。
- 不保存完整 prompt、完整对话、API Key、工具原始输出或 Guardrail 未通过草稿。
- 记忆只作为教学上下文，不应在学生可见回复中生硬暴露。
- 当前记忆信号由规则版 `ReflectionAgent v1` 生成，已区分 observation / inference / uncertainty；后续可替换为 LLM 反思输出。
