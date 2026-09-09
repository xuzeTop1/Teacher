-- 0004: 会话级私有资料绑定表
-- 每个 conversation 最多绑定 1 个 private_document（0 或 1）。
-- 删除 private_document 时由 Rust 代码在同一事务内清理绑定。

CREATE TABLE IF NOT EXISTS conversation_private_documents (
  conversation_id TEXT NOT NULL,
  private_document_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (conversation_id),
  FOREIGN KEY (conversation_id) REFERENCES conversations(id),
  FOREIGN KEY (private_document_id) REFERENCES private_documents(id)
);
