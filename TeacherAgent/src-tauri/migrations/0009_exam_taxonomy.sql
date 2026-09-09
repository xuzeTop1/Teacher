PRAGMA foreign_keys = ON;

-- 考试体系（ExamTaxonomy）扩展（2026-08-07）。
-- 只增加可选列，不删除/不重建既有数据；旧数据库升级后兼容。

-- sync_subjects：手机端声明（可选）的考试体系归属，仅作展示与映射建议，不是权威映射。
ALTER TABLE sync_subjects ADD COLUMN exam_track_id TEXT;
ALTER TABLE sync_subjects ADD COLUMN exam_subject_id TEXT;
ALTER TABLE sync_subjects ADD COLUMN exam_module_id TEXT;

-- subject_mappings：用户映射可指向考试体系叶子（exam_subject_id 优先）；
-- 旧 teacher_subject_id 保留兼容（如 custom-* 与旧平面学科码）。
ALTER TABLE subject_mappings ADD COLUMN exam_track_id TEXT;
ALTER TABLE subject_mappings ADD COLUMN exam_subject_id TEXT;
ALTER TABLE subject_mappings ADD COLUMN exam_module_id TEXT;
