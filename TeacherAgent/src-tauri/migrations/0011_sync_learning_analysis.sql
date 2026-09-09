PRAGMA foreign_keys = ON;

-- Per-snapshot learning analysis read model. This is analysis output only:
-- it must never be used as a source for mastery/profile writes.
CREATE TABLE IF NOT EXISTS sync_learning_analyses (
  analysis_id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  snapshot_id TEXT NOT NULL UNIQUE,
  generated_at INTEGER NOT NULL,
  prompt_version TEXT NOT NULL,
  generator TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (snapshot_id) REFERENCES sync_snapshots(id)
);

CREATE INDEX IF NOT EXISTS idx_sync_learning_analyses_device_generated
  ON sync_learning_analyses(device_id, generated_at DESC);
