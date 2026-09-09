# Knowledge Services

知识库检索服务。

## 当前状态

- ✅ 本地 JSON seed 检索: localKnowledgeSearch.ts（keyword/hybrid mock）
- ✅ 向量搜索服务: vectorSearch.ts（调用 Rust vector commands）
- ✅ 知识库 seed: 53 个节点（极限 35 + 线代 10 + 概率 8）
- ✅ 题库 seed: 22 道题目（极限 12 + 线代 5 + 概率 5）

## 部分完成

- ⚠️ 向量检索: Rust 基础设施已就绪（BLOB 存储 + 余弦相似度），但 seed embedding 尚未生成
- ⚠️ 知识图谱可视化: SVG 页面已实现，数据来自 student_knowledge + knowledge_edges

## 未完成

- SQLite-vec ANN 索引: 当前为纯 Rust 线性扫描，需网络恢复后添加 sqlite-vec crate
- Seed embedding 自动生成: 需配置支持 embedding 的 Provider
- 多学科扩展: 当前仅数学（极限、线代、概率）
