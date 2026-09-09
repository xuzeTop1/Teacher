-- 0014_sync_owner_identity.sql
-- 引入「手机稳定身份（owner identity）」以让用户配置（学科映射）跨重新配对保留。
--
-- 背景：deviceId 由 TeacherAgent 每次配对时临时签发，重新配对即变化，导致
-- subject_mappings 等按 device_id 归属的用户配置「丢失」。
-- 手机端安装期生成并持久化 ownerIdentity，配对时上报；本迁移为 legacy 数据回填。

-- 1) sync_devices 增加 owner_identity 列（可空，配对时由手机携带）
ALTER TABLE sync_devices ADD COLUMN owner_identity TEXT;

-- 2) legacy 设备（本功能前已配对、无 ownerIdentity）以自身 device_id 作为 owner，
--    保证既有映射继续可寻址。
UPDATE sync_devices SET owner_identity = id
 WHERE owner_identity IS NULL OR owner_identity = '';

-- 3) subject_mappings 增加 owner_identity 列，并从其设备回填
ALTER TABLE subject_mappings ADD COLUMN owner_identity TEXT;

UPDATE subject_mappings
   SET owner_identity = COALESCE(
         (SELECT d.owner_identity FROM sync_devices d WHERE d.id = subject_mappings.device_id),
         subject_mappings.device_id
       )
 WHERE owner_identity IS NULL OR owner_identity = '';

-- 4) 重建 subject_mappings，改用 owner_identity 作为归属键（PK 随之更新）
CREATE TABLE subject_mappings_new (
  owner_identity TEXT NOT NULL,
  alert_subject_remote_id TEXT NOT NULL,
  teacher_subject_id TEXT NOT NULL,
  exam_track_id TEXT,
  exam_subject_id TEXT,
  exam_module_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (owner_identity, alert_subject_remote_id)
);

INSERT INTO subject_mappings_new
  (owner_identity, alert_subject_remote_id, teacher_subject_id,
   exam_track_id, exam_subject_id, exam_module_id, created_at, updated_at)
SELECT owner_identity, alert_subject_remote_id, teacher_subject_id,
       exam_track_id, exam_subject_id, exam_module_id, created_at, updated_at
  FROM subject_mappings;

DROP TABLE subject_mappings;
ALTER TABLE subject_mappings_new RENAME TO subject_mappings;

CREATE INDEX idx_subject_mappings_owner ON subject_mappings (owner_identity);
