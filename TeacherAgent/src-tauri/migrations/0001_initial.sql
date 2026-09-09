PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS students (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  stage TEXT,
  active_goal_id TEXT,
  preferences_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS subjects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  style_key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS content_sources (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  url TEXT,
  source_type TEXT NOT NULL,
  license TEXT NOT NULL,
  attribution_required INTEGER NOT NULL DEFAULT 0,
  commercial_use_allowed INTEGER NOT NULL DEFAULT 0,
  derivative_allowed INTEGER NOT NULL DEFAULT 0,
  share_alike_required INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS learning_goals (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  name TEXT NOT NULL,
  target_date TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  FOREIGN KEY (student_id) REFERENCES students(id),
  FOREIGN KEY (subject_id) REFERENCES subjects(id)
);

CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL,
  subject_id TEXT,
  learning_goal_id TEXT,
  title TEXT NOT NULL,
  summary TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  FOREIGN KEY (student_id) REFERENCES students(id),
  FOREIGN KEY (subject_id) REFERENCES subjects(id),
  FOREIGN KEY (learning_goal_id) REFERENCES learning_goals(id)
);

CREATE TABLE IF NOT EXISTS student_cognitive_profiles (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL,
  subject_id TEXT,
  learning_goals_json TEXT NOT NULL DEFAULT '[]',
  explanation_preferences_json TEXT NOT NULL DEFAULT '[]',
  recurring_misconceptions_json TEXT NOT NULL DEFAULT '[]',
  effective_strategies_json TEXT NOT NULL DEFAULT '[]',
  affective_signals_json TEXT NOT NULL DEFAULT '[]',
  confidence REAL NOT NULL DEFAULT 0.0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  FOREIGN KEY (student_id) REFERENCES students(id),
  FOREIGN KEY (subject_id) REFERENCES subjects(id),
  UNIQUE (student_id, subject_id)
);

CREATE TABLE IF NOT EXISTS long_term_memories (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL,
  subject_id TEXT,
  memory_kind TEXT NOT NULL,
  summary TEXT NOT NULL,
  evidence TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 0.0,
  source TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  FOREIGN KEY (student_id) REFERENCES students(id),
  FOREIGN KEY (subject_id) REFERENCES subjects(id)
);

CREATE INDEX IF NOT EXISTS idx_long_term_memories_student ON long_term_memories(student_id, subject_id, memory_kind);

CREATE TABLE IF NOT EXISTS short_term_memories (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  student_id TEXT NOT NULL,
  subject_id TEXT,
  summary TEXT NOT NULL,
  recent_focus_json TEXT NOT NULL DEFAULT '[]',
  open_questions_json TEXT NOT NULL DEFAULT '[]',
  last_misconceptions_json TEXT NOT NULL DEFAULT '[]',
  last_mode TEXT,
  turn_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id),
  FOREIGN KEY (student_id) REFERENCES students(id),
  FOREIGN KEY (subject_id) REFERENCES subjects(id),
  UNIQUE (conversation_id)
);

CREATE TABLE IF NOT EXISTS knowledge_nodes (
  id TEXT PRIMARY KEY,
  subject_id TEXT NOT NULL,
  title TEXT NOT NULL,
  slug TEXT NOT NULL,
  summary TEXT NOT NULL,
  level TEXT NOT NULL,
  difficulty INTEGER NOT NULL DEFAULT 1,
  prerequisites_json TEXT NOT NULL DEFAULT '[]',
  misconceptions_json TEXT NOT NULL DEFAULT '[]',
  socratic_hints_json TEXT NOT NULL DEFAULT '[]',
  source_id TEXT,
  license_snapshot TEXT,
  review_status TEXT NOT NULL DEFAULT 'draft',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (subject_id) REFERENCES subjects(id),
  FOREIGN KEY (source_id) REFERENCES content_sources(id)
);

CREATE INDEX IF NOT EXISTS idx_knowledge_nodes_subject ON knowledge_nodes(subject_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_nodes_slug ON knowledge_nodes(slug);

CREATE TABLE IF NOT EXISTS knowledge_edges (
  id TEXT PRIMARY KEY,
  subject_id TEXT NOT NULL,
  from_node_id TEXT NOT NULL,
  to_node_id TEXT NOT NULL,
  relation_type TEXT NOT NULL,
  weight REAL NOT NULL DEFAULT 1.0,
  created_at TEXT NOT NULL,
  FOREIGN KEY (subject_id) REFERENCES subjects(id),
  FOREIGN KEY (from_node_id) REFERENCES knowledge_nodes(id),
  FOREIGN KEY (to_node_id) REFERENCES knowledge_nodes(id)
);

CREATE TABLE IF NOT EXISTS questions (
  id TEXT PRIMARY KEY,
  subject_id TEXT NOT NULL,
  title TEXT,
  content TEXT NOT NULL,
  question_type TEXT NOT NULL,
  difficulty INTEGER NOT NULL DEFAULT 1,
  answer TEXT,
  solution_steps_json TEXT NOT NULL DEFAULT '[]',
  hints_json TEXT NOT NULL DEFAULT '[]',
  knowledge_node_ids_json TEXT NOT NULL DEFAULT '[]',
  source_id TEXT,
  license_snapshot TEXT,
  review_status TEXT NOT NULL DEFAULT 'draft',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (subject_id) REFERENCES subjects(id),
  FOREIGN KEY (source_id) REFERENCES content_sources(id)
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  content_format TEXT NOT NULL DEFAULT 'markdown',
  token_count INTEGER,
  knowledge_refs_json TEXT NOT NULL DEFAULT '[]',
  tool_refs_json TEXT NOT NULL DEFAULT '[]',
  guardrail_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id)
);

CREATE TABLE IF NOT EXISTS student_knowledge (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL,
  knowledge_node_id TEXT NOT NULL,
  mastery_probability REAL NOT NULL DEFAULT 0.0,
  attempts_count INTEGER NOT NULL DEFAULT 0,
  correct_count INTEGER NOT NULL DEFAULT 0,
  last_practiced_at TEXT,
  last_evidence_message_id TEXT,
  evidence_summary TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (student_id) REFERENCES students(id),
  FOREIGN KEY (knowledge_node_id) REFERENCES knowledge_nodes(id),
  FOREIGN KEY (last_evidence_message_id) REFERENCES messages(id),
  UNIQUE (student_id, knowledge_node_id)
);

CREATE TABLE IF NOT EXISTS reflection_records (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  student_id TEXT NOT NULL,
  summary TEXT NOT NULL,
  knowledge_updates_json TEXT NOT NULL DEFAULT '[]',
  misconceptions_json TEXT NOT NULL DEFAULT '[]',
  strategy_insights_json TEXT NOT NULL DEFAULT '[]',
  next_best_action_json TEXT NOT NULL DEFAULT '{}',
  confidence REAL NOT NULL DEFAULT 0.0,
  created_at TEXT NOT NULL,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id),
  FOREIGN KEY (student_id) REFERENCES students(id)
);

CREATE TABLE IF NOT EXISTS assessment_results (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  learning_goal_id TEXT,
  conversation_id TEXT,
  assessment_type TEXT NOT NULL,
  overall_level TEXT NOT NULL,
  strengths_json TEXT NOT NULL DEFAULT '[]',
  weaknesses_json TEXT NOT NULL DEFAULT '[]',
  recommendations_json TEXT NOT NULL DEFAULT '[]',
  evidence_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  FOREIGN KEY (student_id) REFERENCES students(id),
  FOREIGN KEY (subject_id) REFERENCES subjects(id),
  FOREIGN KEY (learning_goal_id) REFERENCES learning_goals(id),
  FOREIGN KEY (conversation_id) REFERENCES conversations(id)
);

CREATE TABLE IF NOT EXISTS provider_configs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  provider_type TEXT NOT NULL,
  base_url TEXT NOT NULL,
  model TEXT NOT NULL,
  api_key_ref TEXT,
  is_default INTEGER NOT NULL DEFAULT 0,
  is_local INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
