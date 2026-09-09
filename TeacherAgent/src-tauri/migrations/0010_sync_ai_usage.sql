PRAGMA foreign_keys = ON;

-- AI 使用时间扩展（2026-08-07）。
-- 只增加可选列，不删除/不重建既有数据；旧快照（无 AI 字段）解析为默认值。

ALTER TABLE sync_study_sessions ADD COLUMN ai_help_seconds INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sync_study_sessions ADD COLUMN ai_help_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sync_study_sessions ADD COLUMN external_ai_app_seconds INTEGER;
ALTER TABLE sync_study_sessions ADD COLUMN ai_usage_source TEXT;
