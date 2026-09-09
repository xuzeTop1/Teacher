PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS vector_embeddings (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  embedding BLOB NOT NULL,
  embedding_model TEXT NOT NULL,
  embedding_dim INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (entity_type, entity_id, embedding_model)
);

CREATE INDEX IF NOT EXISTS idx_vector_embeddings_entity
  ON vector_embeddings(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_vector_embeddings_model
  ON vector_embeddings(embedding_model);
