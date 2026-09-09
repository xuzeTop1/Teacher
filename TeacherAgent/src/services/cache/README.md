# Cache Services

MVP 当前只实现前端内存缓存，用于减少重复诊断、重复渲染或后续非个性化 LLM 请求。

规则：

- 不缓存 API Key、Authorization header 或密钥。
- 持久化缓存必须只保存 hash key，不保存完整敏感输入。
- Prompt、知识库、学生画像、模型配置变化时必须改变 key。
- 缓存 key 使用规范化序列化：排序 JSON key、压缩空白、剔除时间戳和 request id 等易变字段。
- 需要长期保存的缓存应后移到 Tauri/Rust + SQLite 层。

相关实现：

- `canonicalSerializer.ts`：稳定序列化和易变字段剔除。
- `cacheKey.ts`：scope/version/hash 形式的缓存 key。
- `memoryCacheStore.ts`：MVP 内存 TTL cache。
