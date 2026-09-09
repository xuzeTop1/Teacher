package com.hxz.alerttime.app.data.local

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.withTransaction
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase
import com.hxz.alerttime.app.data.local.dao.AppSettingDao
import com.hxz.alerttime.app.data.local.dao.DiaryDao
import com.hxz.alerttime.app.data.local.dao.StudySessionDao
import com.hxz.alerttime.app.data.local.dao.SubjectDao
import com.hxz.alerttime.app.data.local.dao.TaskDao
import com.hxz.alerttime.app.data.local.dao.UserDao
import com.hxz.alerttime.app.data.local.dao.WeeklyGoalDao
import com.hxz.alerttime.app.data.local.entity.AppSettingEntity
import com.hxz.alerttime.app.data.local.entity.DiaryEntity
import com.hxz.alerttime.app.data.local.entity.StudySessionEntity
import com.hxz.alerttime.app.data.local.entity.StudySessionEventEntity
import com.hxz.alerttime.app.data.local.entity.SubjectEntity
import com.hxz.alerttime.app.data.local.entity.TaskEntity
import com.hxz.alerttime.app.data.local.entity.UserEntity
import com.hxz.alerttime.app.data.local.entity.WeeklyGoalEntity

/** Room schema version; referenced by the backup protocol (databaseVersion). */
const val ALERT_TIME_DATABASE_VERSION = 5

@Database(
    entities = [
        UserEntity::class,
        SubjectEntity::class,
        StudySessionEntity::class,
        StudySessionEventEntity::class,
        TaskEntity::class,
        DiaryEntity::class,
        AppSettingEntity::class,
        WeeklyGoalEntity::class
    ],
    version = ALERT_TIME_DATABASE_VERSION,
    exportSchema = true
)
abstract class AlertTimeDatabase : RoomDatabase() {
    abstract fun userDao(): UserDao
    abstract fun subjectDao(): SubjectDao
    abstract fun studySessionDao(): StudySessionDao
    abstract fun taskDao(): TaskDao
    abstract fun diaryDao(): DiaryDao
    abstract fun appSettingDao(): AppSettingDao
    abstract fun weeklyGoalDao(): WeeklyGoalDao

    companion object {
        fun create(context: Context): AlertTimeDatabase {
            return Room.databaseBuilder(
                context.applicationContext,
                AlertTimeDatabase::class.java,
                "alert_time.db"
            )
                .addMigrations(MIGRATION_1_2, MIGRATION_2_3, MIGRATION_3_4, MIGRATION_4_5)
                .build()
        }

        /**
         * Returns the local user ID, creating a default user if none exists.
         * Centralized here so repositories don't need to instantiate HomeRepository.
         */
        suspend fun ensureLocalUser(database: AlertTimeDatabase): UserEntity {
            return database.withTransaction {
                database.userDao().getDefaultUser() ?: run {
                    val now = System.currentTimeMillis()
                    val userId = database.userDao().upsert(
                        UserEntity(
                            nickname = "学习者",
                            createdAt = now,
                            updatedAt = now
                        )
                    )
                    database.userDao().getUser(userId)
                        ?: error("创建本地用户失败")
                }
            }
        }

        suspend fun ensureLocalUserId(database: AlertTimeDatabase): Long {
            return ensureLocalUser(database).id
        }

        internal val MIGRATION_1_2 = object : Migration(1, 2) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE study_session_events ADD COLUMN event_detail TEXT")
            }
        }

        internal val MIGRATION_2_3 = object : Migration(2, 3) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE tasks ADD COLUMN target_duration_seconds INTEGER")
            }
        }

        internal val MIGRATION_3_4 = object : Migration(3, 4) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL(
                    """
                    CREATE TABLE IF NOT EXISTS weekly_goals (
                        id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
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
                        sync_status INTEGER NOT NULL,
                        FOREIGN KEY(user_id) REFERENCES users(id) ON UPDATE NO ACTION ON DELETE CASCADE
                    )
                    """.trimIndent()
                )
                db.execSQL(
                    "CREATE INDEX IF NOT EXISTS index_weekly_goals_user_id_week_start " +
                        "ON weekly_goals (user_id, week_start)"
                )
            }
        }

        /**
         * v4 → v5：study_sessions 增加 ai_help_seconds（AI 求助时长，写回会话记录）。
         * 只加列不删改，旧数据默认 0；备份协议接受 v4 备份（见 BackupValidator）。
         */
        internal val MIGRATION_4_5 = object : Migration(4, 5) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE study_sessions ADD COLUMN ai_help_seconds INTEGER NOT NULL DEFAULT 0")
            }
        }
    }
}
