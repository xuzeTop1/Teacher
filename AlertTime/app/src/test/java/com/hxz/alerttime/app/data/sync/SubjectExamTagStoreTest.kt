package com.hxz.alerttime.app.data.sync

import com.hxz.alerttime.app.data.local.dao.AppSettingDao
import com.hxz.alerttime.app.data.local.entity.AppSettingEntity
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** 内存版 AppSettingDao：只测 SubjectExamTagStore 的读写语义，不依赖 Room。 */
private class FakeAppSettingDao : AppSettingDao {
    private val store = MutableStateFlow<Map<String, AppSettingEntity>>(emptyMap())

    override fun observeSetting(key: String): Flow<AppSettingEntity?> =
        MutableStateFlow(store.value[key])

    override suspend fun getSetting(key: String): AppSettingEntity? = store.value[key]

    override suspend fun exportAll(): List<AppSettingEntity> = store.value.values.toList()

    override suspend fun deleteAll() {
        store.value = emptyMap()
    }

    override suspend fun insertAll(settings: List<AppSettingEntity>) {
        store.value = store.value + settings.associateBy { it.key }
    }

    override suspend fun insertAllIgnoring(settings: List<AppSettingEntity>) {
        store.value = store.value + settings.filter { it.key !in store.value }.associateBy { it.key }
    }

    override suspend fun upsert(setting: AppSettingEntity) {
        store.value = store.value + (setting.key to setting)
    }

    override suspend fun upsertAll(settings: List<AppSettingEntity>) {
        store.value = store.value + settings.associateBy { it.key }
    }

    override suspend fun delete(key: String) {
        store.value = store.value - key
    }

    override suspend fun deleteSyncRuntimeSettings() {
        store.value = store.value.filterKeys { !it.startsWith("sync_") }
    }
}

class SubjectExamTagStoreTest {

    @Test
    fun `save get clear roundtrip`() = runBlocking {
        val store = SubjectExamTagStore(FakeAppSettingDao())
        val remoteId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"

        assertNull(store.get(remoteId))

        store.save(
            remoteId,
            SubjectExamTag(
                examTrackId = "408",
                examSubjectId = "408.computer-networks",
                examModuleId = null
            )
        )
        val tag = store.get(remoteId)
        assertEquals("408", tag?.examTrackId)
        assertEquals("408.computer-networks", tag?.examSubjectId)
        assertNull(tag?.examModuleId)

        store.clear(remoteId)
        assertNull(store.get(remoteId))
    }

    @Test
    fun `all returns tags keyed by remote id and ignores unrelated settings`() = runBlocking {
        val dao = FakeAppSettingDao()
        dao.upsert(AppSettingEntity("unrelated_key", "value", 1))
        val store = SubjectExamTagStore(dao)
        store.save("remote-1", SubjectExamTag("408", "408.data-structures"))
        store.save("remote-2", SubjectExamTag("kaoyan-english", "kaoyan-english.grammar", "mod-1"))

        val all = store.all()
        assertEquals(2, all.size)
        assertEquals("408.data-structures", all["remote-1"]?.examSubjectId)
        assertEquals("kaoyan-english", all["remote-2"]?.examTrackId)
        assertEquals("mod-1", all["remote-2"]?.examModuleId)
    }

    @Test
    fun `corrupt json value is treated as missing`() = runBlocking {
        val dao = FakeAppSettingDao()
        dao.upsert(AppSettingEntity(SubjectExamTagStore.keyFor("remote-1"), "not-json{{", 1))
        val store = SubjectExamTagStore(dao)
        assertNull(store.get("remote-1"))
        assertEquals(emptyMap<String, SubjectExamTag>(), store.all())
    }
}
