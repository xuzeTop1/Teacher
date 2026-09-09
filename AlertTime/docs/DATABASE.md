# AlertTime 数据库设计文档

## 1. 设计目标

AlertTime 第一阶段采用离线优先架构，使用 Room 作为 SQLite 的访问层。数据库设计需要满足以下目标：

- 稳定记录用户真实学习时间。
- 支持计划、便签、日记、科目和统计功能。
- 保留后续账号系统、云同步、多设备同步的扩展空间。
- 尽量避免业务数据和展示状态混在一起。
- 所有核心数据都应可导出、可迁移、可恢复。

## 2. 技术约定

- 本地数据库：SQLite
- Android 访问层：Room
- 主键：本地自增 `id`
- 云端预留：`remote_id`
- 时间字段：统一使用 Unix epoch milliseconds，类型为 `Long`
- 软删除：后续同步场景使用 `deleted_at`
- 同步状态：后续使用 `sync_status`
- 命名风格：
  - 数据库表名使用 snake_case 复数形式。
  - Kotlin Entity 使用 PascalCase。
  - 字段名使用 snake_case。

## 3. 通用字段约定

大多数业务表建议保留以下字段：

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | INTEGER | 本地自增主键 |
| `remote_id` | TEXT | 云端 ID，第一版可为空 |
| `created_at` | INTEGER | 创建时间 |
| `updated_at` | INTEGER | 更新时间 |
| `deleted_at` | INTEGER | 软删除时间，未删除为空 |
| `sync_status` | INTEGER | 同步状态，第一版默认 0 |

`sync_status` 建议枚举：

| 值 | 含义 |
|---|---|
| 0 | 已同步或无需同步 |
| 1 | 待创建 |
| 2 | 待更新 |
| 3 | 待删除 |
| 4 | 同步失败 |

第一版可以先实现本地字段，但不启用云同步逻辑。

## 4. 数据表设计

### 4.1 用户表 users

第一版可以只创建默认本地用户。后续接入账号系统时再扩展。

```sql
CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    remote_id TEXT,
    nickname TEXT NOT NULL,
    avatar_url TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER,
    sync_status INTEGER NOT NULL DEFAULT 0
);
```

说明：

- 单机版默认创建一个本地用户。
- 后续云同步时，`remote_id` 对应服务端用户 ID。

### 4.2 科目表 subjects

用于区分英语、数学、专业课、阅读、编程等学习分类。

```sql
CREATE TABLE subjects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    remote_id TEXT,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    color TEXT,
    icon TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_archived INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER,
    sync_status INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY(user_id) REFERENCES users(id)
);
```

建议默认科目：

- 未分类
- 英语
- 数学
- 专业课
- 阅读

### 4.3 学习会话表 study_sessions

记录一次完整学习过程，是统计功能的核心数据来源。

```sql
CREATE TABLE study_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    remote_id TEXT,
    user_id INTEGER NOT NULL,
    subject_id INTEGER,
    task_id INTEGER,
    title TEXT,
    start_time INTEGER NOT NULL,
    end_time INTEGER,
    duration_seconds INTEGER NOT NULL DEFAULT 0,
    pause_seconds INTEGER NOT NULL DEFAULT 0,
    focus_score INTEGER,
    note TEXT,
    status INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER,
    sync_status INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY(user_id) REFERENCES users(id),
    FOREIGN KEY(subject_id) REFERENCES subjects(id),
    FOREIGN KEY(task_id) REFERENCES tasks(id)
);
```

`status` 建议枚举：

| 值 | 含义 |
|---|---|
| 0 | 已完成 |
| 1 | 进行中 |
| 2 | 已取消 |
| 3 | 异常结束 |

计时规则：

- `duration_seconds` 表示真实学习时长，不包含暂停时间。
- `pause_seconds` 表示暂停累计时长。
- 如果 App 被系统杀掉，重新打开时应根据最近一次 `status = 1` 的记录进行恢复或提示用户处理。

### 4.4 学习会话事件表 study_session_events

用于更准确地还原开始、暂停、继续、结束等行为。第一版可选，但建议保留。

```sql
CREATE TABLE study_session_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL,
    event_type INTEGER NOT NULL,
    event_time INTEGER NOT NULL,
    event_detail TEXT,
    created_at INTEGER NOT NULL,
    FOREIGN KEY(session_id) REFERENCES study_sessions(id)
);
```

`event_type` 建议枚举：

| 值 | 含义 |
|---|---|
| 1 | 开始 |
| 2 | 暂停 |
| 3 | 继续 |
| 4 | 结束 |
| 5 | 取消 |
| 6 | 分心，通常表示学习计时运行中 App 进入后台 |
| 7 | 分心 App，`event_detail` 保存应用名和包名 |

### 4.5 计划和便签表 tasks

计划、待办和轻量便签统一放在 `tasks` 表中，通过 `type` 区分。

```sql
CREATE TABLE tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    remote_id TEXT,
    user_id INTEGER NOT NULL,
    subject_id INTEGER,
    title TEXT NOT NULL,
    content TEXT,
    type INTEGER NOT NULL DEFAULT 0,
    priority INTEGER NOT NULL DEFAULT 0,
    status INTEGER NOT NULL DEFAULT 0,
    due_at INTEGER,
    completed_at INTEGER,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER,
    sync_status INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY(user_id) REFERENCES users(id),
    FOREIGN KEY(subject_id) REFERENCES subjects(id)
);
```

`type` 建议枚举：

| 值 | 含义 |
|---|---|
| 0 | 待办 |
| 1 | 计划 |
| 2 | 便签 |

`priority` 建议枚举：

| 值 | 含义 |
|---|---|
| 0 | 普通 |
| 1 | 重要 |
| 2 | 紧急 |

`status` 建议枚举：

| 值 | 含义 |
|---|---|
| 0 | 未完成 |
| 1 | 已完成 |
| 2 | 已归档 |

### 4.6 日记表 diaries

用于记录每日学习复盘、心情和总结。

```sql
CREATE TABLE diaries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    remote_id TEXT,
    user_id INTEGER NOT NULL,
    title TEXT,
    content TEXT NOT NULL,
    mood INTEGER,
    diary_date INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER,
    sync_status INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY(user_id) REFERENCES users(id)
);
```

`mood` 第一版可选，建议枚举：

| 值 | 含义 |
|---|---|
| 0 | 未设置 |
| 1 | 较差 |
| 2 | 一般 |
| 3 | 良好 |
| 4 | 很好 |

### 4.7 每日目标表 daily_goals

记录用户每天或长期设置的学习目标。

```sql
CREATE TABLE daily_goals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    remote_id TEXT,
    user_id INTEGER NOT NULL,
    goal_date INTEGER NOT NULL,
    target_seconds INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER,
    sync_status INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY(user_id) REFERENCES users(id)
);
```

说明：

- `goal_date` 建议存当天 00:00:00 的 epoch milliseconds。
- 如果用户没有单独设置某天目标，可使用全局默认目标。

### 4.8 设置表 app_settings

保存本地应用配置。

```sql
CREATE TABLE app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL
);
```

建议配置项：

| key | 说明 |
|---|---|
| `default_daily_goal_seconds` | 默认每日学习目标 |
| `timer_keep_screen_on` | 计时时是否保持屏幕常亮 |
| `theme_mode` | 主题模式 |
| `reminder_enabled` | 是否开启提醒 |
| `last_active_subject_id` | 最近使用科目 |

### 4.9 周成果目标表 weekly_goals

记录某一自然周必须完成的成果，不预先分配到每天。

```sql
CREATE TABLE weekly_goals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    remote_id TEXT,
    user_id INTEGER NOT NULL,
    week_start INTEGER NOT NULL,
    title TEXT NOT NULL,
    success_criteria TEXT,
    status INTEGER NOT NULL,
    completed_at INTEGER,
    deferred_to_week_start INTEGER,
    exception_reason TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER,
    sync_status INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
```

`status`：`0` 待完成、`1` 已完成、`2` 已延期、`3` 已取消。延期会保留原记录，
并在目标周创建新的待完成记录。

## 5. 索引建议

```sql
CREATE INDEX index_subjects_user_id ON subjects(user_id);
CREATE INDEX index_study_sessions_user_id ON study_sessions(user_id);
CREATE INDEX index_study_sessions_subject_id ON study_sessions(subject_id);
CREATE INDEX index_study_sessions_start_time ON study_sessions(start_time);
CREATE INDEX index_tasks_user_id ON tasks(user_id);
CREATE INDEX index_tasks_due_at ON tasks(due_at);
CREATE INDEX index_diaries_user_date ON diaries(user_id, diary_date);
CREATE INDEX index_daily_goals_user_date ON daily_goals(user_id, goal_date);
CREATE INDEX index_weekly_goals_user_id_week_start ON weekly_goals(user_id, week_start);
```

## 6. 统计口径

今日学习时长：

```text
统计与今天时间区间有交集，且 status = 已完成、deleted_at 为空的 study_sessions。
跨天会话优先使用开始、暂停、继续、结束事件重建有效专注区间，再按自然日边界切片。
旧数据缺少事件时才回退为按 start_time/end_time 重叠比例分摊 duration_seconds。
```

本周学习时长：

```text
统计本周一 00:00:00 到下周一 00:00:00 范围内的有效学习时长。
跨天会话按每日边界切片后归属到对应日期。
```

近 7 天趋势：

```text
统计今天及之前连续 6 个本地自然日，用于趋势图展示；本周学习时长仍按周一作为一周开始。
```

连续学习天数：

```text
从今天向前检查每日学习总时长，只要当天学习时长大于 0 即算连续。
```

科目占比：

```text
按 subject_id 聚合本周切片后的 duration_seconds。
未设置 subject_id 的记录归入“未分类”。
```

## 7. Room 实体建议

Kotlin Entity 命名建议：

| 表 | Entity |
|---|---|
| `users` | `UserEntity` |
| `subjects` | `SubjectEntity` |
| `study_sessions` | `StudySessionEntity` |
| `study_session_events` | `StudySessionEventEntity` |
| `tasks` | `TaskEntity` |
| `diaries` | `DiaryEntity` |
| `daily_goals` | `DailyGoalEntity` |
| `app_settings` | `AppSettingEntity` |
| `weekly_goals` | `WeeklyGoalEntity` |

DAO 命名建议：

- `UserDao`
- `SubjectDao`
- `StudySessionDao`
- `TaskDao`
- `DiaryDao`
- `DailyGoalDao`
- `AppSettingDao`
- `WeeklyGoalDao`

## 8. 迁移策略

Room 数据库版本从 `1` 开始。

每次修改表结构必须：

- 提升数据库版本号。
- 增加明确的 Migration。
- 更新本文档。
- 保证已有用户数据不丢失。

禁止在正式版本中使用 destructive migration。

## 9. 云同步预留策略

后续服务端接入时，建议遵循：

- 本地 `id` 只在设备内有效。
- 服务端 ID 写入 `remote_id`。
- 上传时以 `updated_at` 和 `sync_status` 判断是否需要同步。
- 删除优先使用软删除 `deleted_at`。
- 冲突解决第一版可采用“最后更新时间优先”，后续再做更精细的合并策略。

### 9.1 自动备份策略风险

当前 Room 数据库包含日记正文、学习会话和分心应用记录，因此禁止进入 Android 云备份。
`data_extraction_rules.xml` 仅允许系统发起的设备到设备迁移：

- `cloud-backup` 排除整个 database 域。
- `device-transfer` 可包含 database 域，用户主动换机时保留本地数据。
- 接入账号或云同步前，需要重新评估恢复后的去重、冲突和加密策略。

## 10. 第一版落地范围

MVP 必做表：

- `users`
- `subjects`
- `study_sessions`
- `tasks`
- `diaries`
- `app_settings`
- `weekly_goals`

MVP 可选表：

- `study_session_events`
- `daily_goals`

建议即使 UI 暂时不用，也在第一版保留 `study_session_events`，这样计时数据更容易排查和恢复。
