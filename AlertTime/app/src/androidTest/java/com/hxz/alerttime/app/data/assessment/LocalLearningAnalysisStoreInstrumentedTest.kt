package com.hxz.alerttime.app.data.assessment

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.hxz.alerttime.app.data.local.AlertTimeDatabase
import com.hxz.alerttime.app.data.sync.DeterministicLearningAnalysisGenerator
import com.hxz.alerttime.app.data.sync.SyncSnapshotPayload
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class LocalLearningAnalysisStoreInstrumentedTest {
    private lateinit var context: Context
    private var database: AlertTimeDatabase? = null

    @Before
    fun setUp() {
        context = ApplicationProvider.getApplicationContext()
        context.deleteDatabase(DATABASE_NAME)
    }

    @After
    fun tearDown() {
        database?.close()
        database = null
        context.deleteDatabase(DATABASE_NAME)
    }

    @Test
    fun latestAnalysisSurvivesRealRoomCloseAndReopen() = runBlocking {
        val snapshot = SyncSnapshotPayload(
            subjects = emptyList(),
            weeklyGoals = emptyList(),
            tasks = emptyList(),
            studySessions = emptyList()
        )
        val analysis = DeterministicLearningAnalysisGenerator()
            .generate("instrumented-snapshot", snapshot)
        database = openDatabase()
        AppSettingLocalLearningAnalysisStore(requireNotNull(database).appSettingDao())
            .saveLatest(analysis, snapshot, contentFingerprint = "instrumented-fp")
        requireNotNull(database).close()

        database = openDatabase()
        val reloaded = AppSettingLocalLearningAnalysisStore(requireNotNull(database).appSettingDao())
            .loadLatest()

        assertEquals(analysis, reloaded)
    }

    private fun openDatabase(): AlertTimeDatabase = Room.databaseBuilder(
        context,
        AlertTimeDatabase::class.java,
        DATABASE_NAME
    ).build()

    companion object {
        private const val DATABASE_NAME = "learning-analysis-instrumented.db"
    }
}
