# LLM Services

LLM Provider 适配层。

## 当前状态

- ✅ OpenAI-compatible Provider: openAiCompatibleProvider.ts
- ✅ Rust LLM 请求代理: complete_llm_chat command，API Key 从系统凭据存储读取
- ✅ Provider 配置持久化: 非敏感字段存 SQLite，API Key 存 keychain
- ✅ MiMo Provider 兼容: 自动检测 mimo / xiaomimimo.com 并切换请求格式
- ✅ Provider 错误分类与脱敏日志
- ✅ Sentence-Buffered Streaming: 按标点缓冲输出，降低首字延迟
- ✅ LLM 缓存 wrapper: 内存 TTL cache、稳定 JSON key、Provider cached token 指标
- ✅ Prompt Layer 排序: core_system -> tool_schema -> static_context -> session_memory -> history -> runtime

## 需用户操作

- 填写 Provider 名称、Base URL、模型和 API Key
- 测试连接验证

## 未完成

- Ollama 本地模型集成（需用户安装 Ollama）
- Anthropic Claude Provider（预留接口）
