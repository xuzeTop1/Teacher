# Tools Services

工具适配层。

## 当前状态

- ✅ knowledge_search: 本地 JSON seed keyword/hybrid 检索 + SQLite keyword RAG + 向量检索基础设施（723 节点，9 学科，41 Pack）
- ✅ question_bank_search: 本地 JSON seed 题库检索 + SQLite 题库（726 题，9 学科）
- ✅ math_compute: 纯 Rust 符号计算引擎（求导、积分、求值、化简、极限、方程求解）
- ✅ 向量检索基础设施: BLOB 存储 + 余弦相似度搜索（纯 Rust，无 C 扩展依赖）
- ✅ code_runner: Python 代码执行（code-worker sidecar，教学护栏非安全沙箱，timeout clamp 1-30s，仅运行可信练习代码）

## 部分完成

- ⚠️ 向量检索: 基础设施已就绪，embedding 批处理已实现，但全库 embedding 生成需 embedding Provider
- ⚠️ 练习模块: UI 已实现，BKT 闭环已接入，练习结果写回掌握度需实机验证

## 未完成

- web_search: 接口已定义，实际接入待 Phase 2+
- Ollama sidecar: 需用户安装 Ollama
