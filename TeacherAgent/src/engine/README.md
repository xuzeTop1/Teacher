# Engine

教学引擎、Agent 编排、Prompt Builder、护栏策略和学科风格策略放在这里。MVP 普通轮次应优先合并为 1-2 次同步 LLM 调用。

当前已落地：

- `agents/tutorOrchestrator.ts`：Tutor Orchestrator v1，串联 LearningMemoryService、ToolAgent、SocraticAgent、Prompt Builder、Provider 和 Guardrail。
- `agents/toolAgent.ts`：ToolAgent v1，负责本地 `knowledge_search` 路由、`math_compute` 轻量路由与上下文归一化。
- `agents/socraticAgent.ts`：规则版 SocraticAgent v1，不增加 LLM 调用，选择教学模式、提示等级和教学策略。
- `agents/reflectionAgent.ts`：规则版 ReflectionAgent v1，对本轮对话生成 observation / inference / uncertainty、知识更新、误区、策略效果和下一步建议。
- `prompts/tutorSystem.ts`：核心导师 system prompt v1 和输出契约。
- `prompts/tutorPromptBuilder.ts`：Tutor Prompt Builder v1，输出 cache-aware LLM messages，并注入知识、工具和教学策略上下文。
- `prompts/promptLayers.ts`：稳定 Prompt Layer 排序和 cache parts。
- `policies/subjectStyle.ts`：数学、英语、法学、会计、编程的学科风格策略。
- `agents/guardrailAgent.ts`：规则版 GuardrailAgent v1，先做学生可见回复前的确定性审查与兜底。
