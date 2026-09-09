-- 0003: 私有资料文档和 chunk 表
-- 用户确认导入的解析结果，标记为 private draft，不混入内置 Pack。

CREATE TABLE IF NOT EXISTS private_documents (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL,
  subject_code TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_type TEXT NOT NULL,
  title TEXT,
  source_type TEXT NOT NULL DEFAULT 'private_user_import',
  status TEXT NOT NULL DEFAULT 'draft',
  content_hash TEXT,
  chunk_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS private_document_chunks (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  heading TEXT,
  text TEXT NOT NULL,
  token_estimate INTEGER,
  created_at TEXT NOT NULL,
  FOREIGN KEY(document_id) REFERENCES private_documents(id)
);

CREATE INDEX IF NOT EXISTS idx_private_docs_student_subject
  ON private_documents(student_id, subject_code);

CREATE INDEX IF NOT EXISTS idx_private_doc_chunks_doc
  ON private_document_chunks(document_id);
