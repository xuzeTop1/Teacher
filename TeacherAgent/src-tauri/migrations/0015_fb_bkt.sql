-- FB-BKT（融合端侧行为的遗忘感知贝叶斯知识追踪）持久化字段。
-- 论文 §4.3：全部计算中间量（衰减后先验 P(L_t^-)、调节后转移概率 P_T'、
-- 观测后验）与本次消费的端侧聚合特征需落库，供可解释性回放与 PlannerAgent 使用。
-- 向前兼容：旧库升级后新列取默认值，旧更新路径不写这些列。

ALTER TABLE student_knowledge ADD COLUMN last_response_at INTEGER;
ALTER TABLE student_knowledge ADD COLUMN lambda REAL NOT NULL DEFAULT 0.05;
ALTER TABLE student_knowledge ADD COLUMN alpha REAL NOT NULL DEFAULT 0.5;
ALTER TABLE student_knowledge ADD COLUMN beta REAL NOT NULL DEFAULT 0.3;
ALTER TABLE student_knowledge ADD COLUMN p_l_minus REAL;
ALTER TABLE student_knowledge ADD COLUMN p_t_prime REAL;
ALTER TABLE student_knowledge ADD COLUMN last_snapshot_id TEXT;

ALTER TABLE assessment_results ADD COLUMN r_focus REAL;
ALTER TABLE assessment_results ADD COLUMN n_distract INTEGER;
