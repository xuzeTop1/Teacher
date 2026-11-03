-- 协议 v2：端侧专注聚合特征的桌面端落库（论文 §4.3 的 FB-BKT 输入）。
-- 语义与其它同步表一致：每次快照为全量替换，逐设备维护最新一组聚合特征。
CREATE TABLE IF NOT EXISTS sync_focus_aggregates (
  device_id TEXT NOT NULL,
  subject_temp_id INTEGER NOT NULL,
  subject_remote_id TEXT,
  r_focus REAL NOT NULL,
  n_distract INTEGER NOT NULL,
  window_days INTEGER,
  snapshot_id TEXT NOT NULL,
  received_at_ms INTEGER NOT NULL,
  PRIMARY KEY (device_id, subject_temp_id)
);

CREATE INDEX IF NOT EXISTS idx_sync_focus_aggregates_subject
  ON sync_focus_aggregates(subject_remote_id);
