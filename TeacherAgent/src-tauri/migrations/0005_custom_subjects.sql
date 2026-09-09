PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS custom_subjects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  scope_keywords TEXT,
  source_urls_json TEXT NOT NULL DEFAULT '[]',
  review_status TEXT NOT NULL DEFAULT 'draft',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
