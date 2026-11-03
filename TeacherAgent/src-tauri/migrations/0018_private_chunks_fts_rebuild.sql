-- 论文 §4.2：FTS5 外部内容表的既有行回填。
--
-- 0016 建立了倒排表与三个触发器，但 FTS5 的外部内容表（content='private_document_chunks'）
-- **不会**自动索引迁移前就已存在的 private_document_chunks 行——触发器只对迁移之后发生的
-- INSERT/UPDATE/DELETE 生效。于是老库升级后倒排索引为空。
--
-- 更隐蔽的是：外部内容表的 COUNT(*) 会读穿到主表，因此诊断接口与既有测试看到的"索引行数"
-- 依旧正常，而实际 MATCH 返回空集，混合检索静默退化为纯稠密通道（隐私文档片段将完全检索不到）。
--
-- 这里显式执行一次 rebuild，把既有语料回填进倒排索引。对新建库为空表，rebuild 是空操作。

INSERT INTO private_document_chunks_fts(private_document_chunks_fts) VALUES('rebuild');
