# Services

外部能力和数据访问封装放在这里，例如 LLM Provider、knowledge repository、Tauri command 适配器和工具调用。

- `llm/`：OpenAI-compatible Provider、Provider 表单状态、缓存指标和后续模型适配器。
- `student/`：短期记忆、长期记忆、用户画像和后续学生数据访问。
- `knowledge/`：本地知识库检索（JSON seed + SQLite keyword RAG）、向量搜索和知识 indexer（seed 入库）。
- `questions/`：本地题库检索和后续题库 repository。
- `tools/`：数学计算、web search、代码运行等工具适配器。
- `rendering/`：Markdown、KaTeX、Shiki 消息渲染。
- `tauri/`：前端调用 Tauri commands 的薄封装（含 BKT、向量、数学计算等命令）。
