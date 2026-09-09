package com.hxz.alerttime.app.data.local

import androidx.room.testing.MigrationTestHelper
import androidx.sqlite.db.framework.FrameworkSQLiteOpenHelperFactory
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class AlertTimeDatabaseMigrationTest {
    @get:Rule
    val helper = MigrationTestHelper(
        InstrumentationRegistry.getInstrumentation(),
        AlertTimeDatabase::class.java,
        emptyList(),
        FrameworkSQLiteOpenHelperFactory()
    )

    @Test
    fun migrate3To4_createsAndValidatesWeeklyGoals() {
        helper.createDatabase(TEST_DATABASE, 3).close()

        val migrated = helper.runMigrationsAndValidate(
            TEST_DATABASE,
            4,
            true,
            AlertTimeDatabase.MIGRATION_3_4
        )
        migrated.query(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'weekly_goals'"
        ).use { cursor ->
            assertTrue(cursor.moveToFirst())
        }
        migrated.close()
    }

    private companion object {
        const val TEST_DATABASE = "alert-time-migration-test"
    }
}
