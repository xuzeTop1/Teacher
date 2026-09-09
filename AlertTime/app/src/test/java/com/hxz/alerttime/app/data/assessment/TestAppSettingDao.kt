package com.hxz.alerttime.app.data.assessment

import com.hxz.alerttime.app.data.local.dao.AppSettingDao
import com.hxz.alerttime.app.data.local.entity.AppSettingEntity
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flowOf

internal class TestAppSettingDao(initial: List<AppSettingEntity> = emptyList()) : AppSettingDao {
    private val values = initial.associateByTo(linkedMapOf()) { it.key }

    override fun observeSetting(key: String): Flow<AppSettingEntity?> = flowOf(values[key])
    override suspend fun getSetting(key: String): AppSettingEntity? = values[key]
    override suspend fun exportAll(): List<AppSettingEntity> = values.values.sortedBy { it.key }
    override suspend fun deleteAll() = values.clear()
    override suspend fun insertAll(settings: List<AppSettingEntity>) {
        settings.forEach { check(values.putIfAbsent(it.key, it) == null) }
    }
    override suspend fun insertAllIgnoring(settings: List<AppSettingEntity>) {
        settings.forEach { values.putIfAbsent(it.key, it) }
    }
    override suspend fun upsert(setting: AppSettingEntity) {
        values[setting.key] = setting
    }
    override suspend fun upsertAll(settings: List<AppSettingEntity>) {
        settings.forEach { values[it.key] = it }
    }
    override suspend fun delete(key: String) {
        values.remove(key)
    }
    override suspend fun deleteSyncRuntimeSettings() {
        values.keys.filter { it.startsWith("sync_") }.forEach(values::remove)
    }
}
