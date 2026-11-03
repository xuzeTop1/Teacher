-- 论文 §4.2：私有文档混合检索的 BM25 倒排通道。
-- 使用 SQLite 同源编译的 FTS5 外部内容表（external content），不复制正文、不新增运行时依赖。
-- 中文分词采用 trigram tokenizer（无外部分词器依赖，支持中文子串匹配）；
-- 注意 trigram 要求查询串长度 ≥ 3 个字符，短查询由应用层退回纯稠密通道。
-- 触发器保持倒排索引与 private_document_chunks 主表同步。

CREATE VIRTUAL TABLE IF NOT EXISTS private_document_chunks_fts
USING fts5(
    text,
    heading,
    content='private_document_chunks',
    content_rowid='rowid',
    tokenize='trigram'
);

CREATE TRIGGER IF NOT EXISTS private_document_chunks_fts_insert
AFTER INSERT ON private_document_chunks BEGIN
    INSERT INTO private_document_chunks_fts (rowid, text, heading)
    VALUES (new.rowid, new.text, COALESCE(new.heading, ''));
END;

CREATE TRIGGER IF NOT EXISTS private_document_chunks_fts_delete
AFTER DELETE ON private_document_chunks BEGIN
    INSERT INTO private_document_chunks_fts (private_document_chunks_fts, rowid, text, heading)
    VALUES ('delete', old.rowid, old.text, COALESCE(old.heading, ''));
END;

CREATE TRIGGER IF NOT EXISTS private_document_chunks_fts_update
AFTER UPDATE ON private_document_chunks BEGIN
    INSERT INTO private_document_chunks_fts (private_document_chunks_fts, rowid, text, heading)
    VALUES ('delete', old.rowid, old.text, COALESCE(old.heading, ''));
    INSERT INTO private_document_chunks_fts (rowid, text, heading)
    VALUES (new.rowid, new.text, COALESCE(new.heading, ''));
END;
