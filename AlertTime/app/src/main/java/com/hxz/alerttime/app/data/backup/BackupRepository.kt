package com.hxz.alerttime.app.data.backup

import android.content.ContentValues
import android.content.ContentResolver
import android.content.ContentUris
import android.content.Context
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.provider.MediaStore
import android.util.Log
import androidx.annotation.RequiresApi
import androidx.room.withTransaction
import com.hxz.alerttime.app.BuildConfig
import com.hxz.alerttime.app.data.local.ALERT_TIME_DATABASE_VERSION
import com.hxz.alerttime.app.data.local.AlertTimeDatabase
import com.hxz.alerttime.app.data.sync.ProposalSourceMappingCodec
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.InputStream
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Orchestrates local JSON backup: consistent snapshot export, atomic full restore,
 * and the latest backup kept in the user's shared Downloads/AlertTime folder.
 *
 * Design notes:
 * - Export reads every collection inside ONE Room read transaction, so the snapshot
 *   is consistent even if other writers are active.
 * - Restore writes everything inside ONE write transaction: delete children first,
 *   insert parents first, keeping every local primary key so the backup's own
 *   foreign-key relations stay intact. Any failure rolls back the whole restore.
 * - Export, recent-backup write and restore are gated by the shared
 *   [BackupTimerGate]: while the timer is running, paused, recovering or still
 *   persisting, backup/restore is refused; while a backup operation runs, the
 *   timer cannot start.
 * - The default backup is written through MediaStore to Downloads/AlertTime. It is
 *   visible in file managers and survives app uninstall; restoring after reinstall
 *   uses the existing JSON file picker.
 * - The same 32 MiB size limit applied to imports is enforced on exports and on
 *   recent-backup writes, so an exported file can never be un-restorable for size.
 * - Writes to the recent backup are atomic (temp file + rename): a failed update
 *   keeps the previous usable backup.
 */
class BackupRepository(
    private val database: AlertTimeDatabase,
    private val context: Context,
    private val backupGate: BackupTimerGate,
    /** Test hook: isolated recent-backup directory; null = production location. */
    private val recentBackupRoot: File? = null
) {
    /** Application-level mutex shared by export and import: no concurrent operations. */
    private val operationMutex = Mutex()

    companion object {
        private const val TAG = "AlertTimeBackup"

        const val RECENT_BACKUP_DIR = "backups"
        const val RECENT_BACKUP_FILE = "recent-backup.json"
        const val RECENT_BACKUP_TMP_FILE = "recent-backup.json.tmp"
        private const val BACKUP_PREFERENCES = "alerttime_backup"
        private const val RECENT_BACKUP_URI_KEY = "recent_backup_uri"
        private val SHARED_BACKUP_DIRECTORY = "${Environment.DIRECTORY_DOWNLOADS}/AlertTime"
        private val SHARED_BACKUP_RELATIVE_PATH = "$SHARED_BACKUP_DIRECTORY/"

        /** Failure message shown for every blocked operation. */
        const val BLOCKED_MESSAGE = "请先结束当前专注，再进行数据备份"

        const val SIZE_LIMIT_MESSAGE = "备份数据超过 32 MiB 上限，无法导出或保存"

        /** 设备绑定/同步运行时 AppSetting 键前缀：不进入明文 JSON 备份。 */
        const val SYNC_RUNTIME_KEY_PREFIX = "sync_"

        /** 设备级计划评估 Provider 配置（含 Keystore 密文）：不进入可迁移 JSON 备份。 */
        const val LEARNING_ANALYSIS_LLM_KEY_PREFIX = "learning_analysis_llm_"

        /** 可由业务数据重新生成的最近分析缓存：不进入备份，也不与新数据合并恢复。 */
        const val LEARNING_ANALYSIS_RUNTIME_KEY_PREFIX = "learning_analysis_runtime_"

        /**
         * 备份导出白名单：设备绑定/同步运行时 key（sync_*）与设备级 Provider 配置
         *（learning_analysis_llm_*）及派生分析缓存（learning_analysis_runtime_*）不进入明文 JSON 备份；
         * 其余 AppSetting（主题、目标等非敏感配置）正常备份。
         */
        fun isBackupEligibleAppSetting(key: String): Boolean {
            return !key.startsWith(SYNC_RUNTIME_KEY_PREFIX) &&
                !key.startsWith(LEARNING_ANALYSIS_LLM_KEY_PREFIX) &&
                !key.startsWith(LEARNING_ANALYSIS_RUNTIME_KEY_PREFIX)
        }
    }

    // --- Snapshot ---

    /** Reads a consistent full snapshot including soft-deleted rows. */
    suspend fun exportSnapshot(): BackupDataDto = withContext(Dispatchers.IO) {
        database.withTransaction {
            BackupDataDto(
                users = database.userDao().exportAll().map { it.toBackupDto() },
                subjects = database.subjectDao().exportAll().map { it.toBackupDto() },
                tasks = database.taskDao().exportAll().map { it.toBackupDto() },
                weeklyGoals = database.weeklyGoalDao().exportAll().map { it.toBackupDto() },
                studySessions = database.studySessionDao().exportAllSessions().map { it.toBackupDto() },
                studySessionEvents = database.studySessionDao().exportAllEvents().map { it.toBackupDto() },
                diaries = database.diaryDao().exportAll().map { it.toBackupDto() },
                // 设备绑定/同步运行时状态、派生分析缓存及设备级 Provider 配置不进入明文 JSON 备份；
                // 其他普通 AppSetting 仍正常备份。
                appSettings = database.appSettingDao().exportAll()
                    .filter { isBackupEligibleAppSetting(it.key) }
                    .map { it.toBackupDto() }
            )
        }
    }

    private fun buildEnvelope(data: BackupDataDto): BackupEnvelopeDto {
        return BackupEnvelopeDto(
            format = BackupProtocol.FORMAT,
            schemaVersion = BackupProtocol.SCHEMA_VERSION,
            databaseVersion = ALERT_TIME_DATABASE_VERSION,
            appVersion = BuildConfig.VERSION_NAME,
            exportedAt = System.currentTimeMillis(),
            data = data
        )
    }

    /**
     * Encodes the envelope and enforces the SAME size limit used on import, so a
     * file that the app would refuse to restore can never be exported or saved as
     * the recent backup.
     */
    private fun encodeEnvelope(data: BackupDataDto): ByteArray {
        val bytes = BackupJsonCodec.encode(buildEnvelope(data)).toByteArray(Charsets.UTF_8)
        if (bytes.size > BackupProtocol.MAX_BACKUP_BYTES) {
            throw BackupFileException(SIZE_LIMIT_MESSAGE)
        }
        return bytes
    }

    // --- Recent local backup ---

    private fun recentBackupDirectory(): File {
        // Production uses shared MediaStore storage so the JSON survives app
        // uninstall. Tests inject an isolated root and MUST never touch it.
        checkNotNull(recentBackupRoot) { "生产环境备份使用共享存储" }
        val root = recentBackupRoot
        return root.apply { mkdirs() }
    }

    private fun recentBackupFile(): File = File(recentBackupDirectory(), RECENT_BACKUP_FILE)

    /**
     * Overwrites the recent local backup atomically. On any failure the previous
     * usable backup is kept.
     */
    private suspend fun writeRecentBackup(data: BackupDataDto) {
        val bytes = encodeEnvelope(data)
        withContext(Dispatchers.IO) {
            if (recentBackupRoot == null) {
                writeSharedBackup(bytes)
                return@withContext
            }
            val dir = recentBackupDirectory()
            val target = File(dir, RECENT_BACKUP_FILE)
            val tmp = File(dir, RECENT_BACKUP_TMP_FILE)
            tmp.writeBytes(bytes)
            if (!tmp.renameTo(target)) {
                tmp.delete()
                throw BackupFileException("保存最近备份失败")
            }
        }
    }

    private data class ReadRecentBackup(
        val preview: RestorePreview,
        val fileSizeBytes: Long
    )

    /**
     * Reads and validates the recent backup. Production first uses the persisted
     * URI, then performs a narrowly scoped MediaStore rediscovery if that URI is
     * absent, revoked or no longer readable. A discovered URI is remembered only
     * after decode and domain validation succeed.
     */
    private suspend fun readRecentBackup(): ReadRecentBackup? = withContext(Dispatchers.IO) {
        if (recentBackupRoot != null) {
            val file = recentBackupFile()
            if (!file.exists()) return@withContext null
            val bytes = runCatching { file.inputStream().use { readAllBounded(it) } }.getOrNull()
                ?: return@withContext null
            return@withContext decodeAndValidate(bytes)
        }

        recentBackupUri()?.let { uri ->
            readAndValidateUri(uri)?.let { return@withContext it }
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            discoverRecentBackupCandidates().forEach { candidate ->
                val uri = Uri.parse(candidate.uriString)
                readAndValidateUri(uri)?.let {
                    rememberRecentBackupUri(uri)
                    return@withContext it
                }
            }
        }
        null
    }

    private fun decodeAndValidate(bytes: ByteArray): ReadRecentBackup? {
        val envelope = runCatching {
            BackupJsonCodec.decode(bytes.toString(Charsets.UTF_8))
        }.getOrNull() ?: return null
        val preview = runCatching {
            validateEnvelope(envelope, RestoreSource.RECENT_BACKUP)
        }.getOrNull() ?: return null
        return ReadRecentBackup(preview = preview, fileSizeBytes = bytes.size.toLong())
    }

    private fun readAndValidateUri(uri: Uri): ReadRecentBackup? {
        return runCatching {
            val input = context.contentResolver.openInputStream(uri) ?: return@runCatching null
            input.use { decodeAndValidate(readAllBounded(it)) }
        }.getOrNull()
    }

    /**
     * Queries only the app-owned Downloads/AlertTime relative directory. The
     * provider-side limit is paired with the selector's own limit because some
     * MediaStore providers may ignore query arguments. Any provider failure is a
     * normal "no recent backup" result; the user can still use the file picker.
     */
    @RequiresApi(Build.VERSION_CODES.Q)
    private fun discoverRecentBackupCandidates(): List<RecentBackupCandidate> {
        return runCatching {
            val projection = arrayOf(
                MediaStore.MediaColumns._ID,
                MediaStore.MediaColumns.DISPLAY_NAME,
                MediaStore.MediaColumns.MIME_TYPE,
                MediaStore.MediaColumns.RELATIVE_PATH,
                MediaStore.MediaColumns.SIZE,
                MediaStore.MediaColumns.DATE_MODIFIED,
                MediaStore.MediaColumns.IS_PENDING
            )
            val queryArgs = Bundle().apply {
                putString(
                    ContentResolver.QUERY_ARG_SQL_SELECTION,
                    "${MediaStore.MediaColumns.RELATIVE_PATH} = ? AND " +
                        "${MediaStore.MediaColumns.IS_PENDING} = 0 AND " +
                        "${MediaStore.MediaColumns.DISPLAY_NAME} LIKE ?"
                )
                putStringArray(
                    ContentResolver.QUERY_ARG_SQL_SELECTION_ARGS,
                    arrayOf(SHARED_BACKUP_RELATIVE_PATH, "AlertTime-backup-%")
                )
                putStringArray(
                    ContentResolver.QUERY_ARG_SORT_COLUMNS,
                    arrayOf(MediaStore.MediaColumns.DATE_MODIFIED)
                )
                putInt(
                    ContentResolver.QUERY_ARG_SORT_DIRECTION,
                    ContentResolver.QUERY_SORT_DIRECTION_DESCENDING
                )
                putInt(
                    ContentResolver.QUERY_ARG_LIMIT,
                    RecentBackupCandidateSelector.MAX_CANDIDATES
                )
            }
            val resolver = context.contentResolver
            resolver.query(
                MediaStore.Downloads.EXTERNAL_CONTENT_URI,
                projection,
                queryArgs,
                null
            )?.use { cursor ->
                val idIndex = cursor.getColumnIndex(MediaStore.MediaColumns._ID)
                val nameIndex = cursor.getColumnIndex(MediaStore.MediaColumns.DISPLAY_NAME)
                val mimeIndex = cursor.getColumnIndex(MediaStore.MediaColumns.MIME_TYPE)
                val pathIndex = cursor.getColumnIndex(MediaStore.MediaColumns.RELATIVE_PATH)
                val sizeIndex = cursor.getColumnIndex(MediaStore.MediaColumns.SIZE)
                val modifiedIndex = cursor.getColumnIndex(MediaStore.MediaColumns.DATE_MODIFIED)
                val pendingIndex = cursor.getColumnIndex(MediaStore.MediaColumns.IS_PENDING)
                if (idIndex < 0 || nameIndex < 0 || pathIndex < 0 || sizeIndex < 0 || modifiedIndex < 0) {
                    return@use emptyList()
                }
                buildList {
                    while (cursor.moveToNext() && size < RecentBackupCandidateSelector.MAX_CANDIDATES) {
                        val id = cursor.getLong(idIndex)
                        add(
                            RecentBackupCandidate(
                                uriString = ContentUris.withAppendedId(
                                    MediaStore.Downloads.EXTERNAL_CONTENT_URI,
                                    id
                                ).toString(),
                                displayName = cursor.getString(nameIndex),
                                mimeType = mimeIndex.takeIf { it >= 0 && !cursor.isNull(it) }
                                    ?.let(cursor::getString),
                                relativePath = cursor.getString(pathIndex),
                                sizeBytes = if (cursor.isNull(sizeIndex)) -1L else cursor.getLong(sizeIndex),
                                dateModifiedSeconds = if (cursor.isNull(modifiedIndex)) {
                                    -1L
                                } else {
                                    cursor.getLong(modifiedIndex)
                                },
                                isPending = pendingIndex >= 0 && !cursor.isNull(pendingIndex) &&
                                    cursor.getInt(pendingIndex) != 0
                            )
                        )
                    }
                }
            }.orEmpty().let {
                RecentBackupCandidateSelector.orderedEligible(it, SHARED_BACKUP_RELATIVE_PATH)
            }
        }.getOrElse { emptyList() }
    }

    private fun rememberRecentBackupUri(uri: Uri) {
        context.getSharedPreferences(BACKUP_PREFERENCES, Context.MODE_PRIVATE)
            .edit()
            .putString(RECENT_BACKUP_URI_KEY, uri.toString())
            .apply()
    }

    /** True when a recent backup file exists on disk (readable or not). */
    fun hasRecentBackupFile(): Boolean = if (recentBackupRoot == null) {
        recentBackupUri() != null
    } else {
        recentBackupFile().exists()
    }

    /** Metadata for the UI card; null when there is no usable recent backup. */
    suspend fun loadRecentBackupMeta(): RecentBackupMeta? {
        val read = readRecentBackup() ?: return null
        val preview = read.preview
        return RecentBackupMeta(
            exportedAt = preview.exportedAt,
            fileSizeBytes = read.fileSizeBytes,
            schemaVersion = preview.schemaVersion,
            databaseVersion = preview.databaseVersion,
            appVersion = preview.appVersion,
            dataSummary = preview.data.toSummary()
        )
    }

    private fun recentBackupUri(): Uri? = context
        .getSharedPreferences(BACKUP_PREFERENCES, Context.MODE_PRIVATE)
        .getString(RECENT_BACKUP_URI_KEY, null)
        ?.let(Uri::parse)

    /** Writes an uninstall-safe JSON file to Downloads/AlertTime through scoped storage. */
    private fun writeSharedBackup(bytes: ByteArray) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            throw BackupFileException("Android 10 以下无法自动保存到共享下载目录，请使用「导出 JSON 备份」")
        }
        writeMediaStoreBackup(bytes)
    }

    @RequiresApi(Build.VERSION_CODES.Q)
    private fun writeMediaStoreBackup(bytes: ByteArray) {
        val displayName = "AlertTime-backup-" +
            SimpleDateFormat("yyyyMMdd-HHmmss", Locale.US).format(Date()) + ".json"
        val values = ContentValues().apply {
            put(MediaStore.MediaColumns.DISPLAY_NAME, displayName)
            put(MediaStore.MediaColumns.MIME_TYPE, "application/json")
            put(MediaStore.MediaColumns.RELATIVE_PATH, SHARED_BACKUP_DIRECTORY)
            put(MediaStore.MediaColumns.IS_PENDING, 1)
        }
        val resolver = context.contentResolver
        val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
            ?: throw BackupFileException("无法在手机下载目录创建备份文件")
        try {
            resolver.openOutputStream(uri, "w")?.use { it.write(bytes) }
                ?: throw BackupFileException("无法写入手机备份文件")
            resolver.update(uri, ContentValues().apply {
                put(MediaStore.MediaColumns.IS_PENDING, 0)
            }, null, null)
            context.getSharedPreferences(BACKUP_PREFERENCES, Context.MODE_PRIVATE)
                .edit()
                .putString(RECENT_BACKUP_URI_KEY, uri.toString())
                .apply()
        } catch (throwable: Throwable) {
            resolver.delete(uri, null, null)
            throw throwable
        }
    }

    // --- Create / export ---

    /** Explicitly creates (overwrites) the recent local backup. */
    suspend fun createRecentBackup(): BackupOperationResult = operationMutex.withLock {
        val outcome = backupGate.runBackupExclusive {
            runCatching {
                val data = exportSnapshot()
                writeRecentBackup(data)
            }.fold(
                onSuccess = { BackupOperationResult.Success },
                onFailure = { throwable ->
                    logFailure("createRecentBackup", throwable)
                    BackupOperationResult.Failure(userMessage(throwable))
                }
            )
        }
        outcome ?: BackupOperationResult.Failure(BLOCKED_MESSAGE)
    }

    /**
     * Exports a JSON backup to the user-chosen location (SAF Uri), then registers
     * the same data as the recent local backup.
     */
    suspend fun exportToUri(uri: Uri): BackupOperationResult = operationMutex.withLock {
        val outcome = backupGate.runBackupExclusive {
            runCatching {
                val data = exportSnapshot()
                val bytes = encodeEnvelope(data)
                val out = context.contentResolver.openOutputStream(uri, "w")
                    ?: throw BackupFileException("无法写入所选位置")
                withContext(Dispatchers.IO) {
                    out.use { it.write(bytes) }
                }
                // A successful export also registers the recent local backup.
                writeRecentBackup(data)
            }.fold(
                onSuccess = { BackupOperationResult.Success },
                onFailure = { throwable ->
                    logFailure("exportToUri", throwable)
                    BackupOperationResult.Failure(userMessage(throwable))
                }
            )
        }
        outcome ?: BackupOperationResult.Failure(BLOCKED_MESSAGE)
    }

    // --- Inspection (parse + validate, no DB writes) ---

    /** Parses and validates the recent local backup; no database writes. */
    suspend fun inspectRecentBackup(): RestorePreview? {
        return readRecentBackup()?.preview
    }

    /** Parses and validates a user-picked backup file; no database writes. */
    suspend fun inspectFile(uri: Uri): RestorePreview {
        val text = withContext(Dispatchers.IO) {
            val input: InputStream = context.contentResolver.openInputStream(uri)
                ?: throw BackupFileException("无法读取所选文件")
            input.use { stream ->
                val bytes = readAllBounded(stream)
                bytes.toString(Charsets.UTF_8)
            }
        }
        val envelope = runCatching { BackupJsonCodec.decode(text) }
            .getOrElse { throwable ->
                throw BackupFileException("备份文件格式不正确", throwable)
            }
        return validateEnvelope(envelope, RestoreSource.FILE)
    }

    private fun validateEnvelope(envelope: BackupEnvelopeDto, source: RestoreSource): RestorePreview {
        val result = BackupValidator.validate(envelope, currentDatabaseVersion = ALERT_TIME_DATABASE_VERSION)
        if (!result.isValid) {
            throw BackupFileException(result.errors.joinToString("；"))
        }
        return RestorePreview(
            exportedAt = envelope.exportedAt,
            schemaVersion = envelope.schemaVersion,
            databaseVersion = envelope.databaseVersion,
            appVersion = envelope.appVersion,
            data = envelope.data,
            source = source
        )
    }

    // --- Restore ---

    /**
     * Atomically replaces all local data with the validated backup. Delete order is
     * children-first and insert order parents-first, matching the real Room foreign
     * keys. Any failure rolls the entire transaction back, leaving old data intact.
     */
    suspend fun restoreValidated(preview: RestorePreview): BackupOperationResult = operationMutex.withLock {
        val outcome = backupGate.runBackupExclusive {
            runCatching {
                revalidatePreview(preview)
                restoreInTransaction(preview)
            }.fold(
                onSuccess = { BackupOperationResult.Success },
                onFailure = { throwable ->
                    logFailure("restoreValidated", throwable)
                    BackupOperationResult.Failure(userMessage(throwable))
                }
            )
        }
        outcome ?: BackupOperationResult.Failure(BLOCKED_MESSAGE)
    }

    /**
     * Merges a validated backup into the current local data. Existing local rows
     * always win: every backup row is inserted with IGNORE on a primary-key (or
     * app-setting key) conflict. Thus a backup made at A and data created later at
     * B result in A + B, rather than replacing B with A.
     *
     * Parent collections are attempted before their children in one Room
     * transaction, so newly imported foreign-key references remain valid. A
     * conflict means the current row with that same stable local key is retained.
     */
    suspend fun mergeValidated(preview: RestorePreview): BackupOperationResult = operationMutex.withLock {
        val outcome = backupGate.runBackupExclusive {
            runCatching {
                revalidatePreview(preview)
                mergeInTransaction(preview)
            }.fold(
                onSuccess = { BackupOperationResult.Success },
                onFailure = { throwable ->
                    logFailure("mergeValidated", throwable)
                    BackupOperationResult.Failure(userMessage(throwable))
                }
            )
        }
        outcome ?: BackupOperationResult.Failure(BLOCKED_MESSAGE)
    }

    /** Defensive second gate: callers must not be able to write an unvalidated preview. */
    private fun revalidatePreview(preview: RestorePreview) {
        validateEnvelope(
            BackupEnvelopeDto(
                format = BackupProtocol.FORMAT,
                schemaVersion = preview.schemaVersion,
                databaseVersion = preview.databaseVersion,
                appVersion = preview.appVersion,
                exportedAt = preview.exportedAt,
                data = preview.data
            ),
            preview.source
        )
    }

    private suspend fun restoreInTransaction(preview: RestorePreview) {
        val data = preview.data
        // restoreValidated only receives validated previews; collections are
        // guaranteed non-null here, but be explicit instead of trusting the type.
        val users = data.users ?: throw BackupFileException("备份数据不完整")
        val subjects = data.subjects ?: throw BackupFileException("备份数据不完整")
        val tasks = data.tasks ?: throw BackupFileException("备份数据不完整")
        val weeklyGoals = data.weeklyGoals ?: throw BackupFileException("备份数据不完整")
        val sessions = data.studySessions ?: throw BackupFileException("备份数据不完整")
        val events = data.studySessionEvents ?: throw BackupFileException("备份数据不完整")
        val diaries = data.diaries ?: throw BackupFileException("备份数据不完整")
        val appSettings = data.appSettings ?: throw BackupFileException("备份数据不完整")
        database.withTransaction {
            // Delete children before parents.
            database.studySessionDao().deleteAllEvents()
            database.studySessionDao().deleteAllSessions()
            database.taskDao().deleteAll()
            database.diaryDao().deleteAll()
            database.weeklyGoalDao().deleteAll()
            database.subjectDao().deleteAll()
            database.appSettingDao().deleteAll()
            database.userDao().deleteAll()
            // Insert parents before children; local primary keys are preserved.
            database.userDao().insertAll(users.map { it.toEntity() })
            database.subjectDao().insertAll(subjects.map { it.toEntity() })
            database.taskDao().insertAll(tasks.map { it.toEntity() })
            database.weeklyGoalDao().insertAll(weeklyGoals.map { it.toEntity() })
            database.studySessionDao().insertAllSessions(sessions.map { it.toEntity() })
            database.studySessionDao().insertAllEvents(events.map { it.toEntity() })
            database.diaryDao().insertAll(diaries.map { it.toEntity() })
            // 防御性过滤：即使校验被绕过，sync_*、Provider 配置与派生分析缓存也绝不写入。
            database.appSettingDao().insertAll(
                appSettings.filter { isBackupEligibleAppSetting(it.key) }.map { it.toEntity() }
            )
            // Restored rows may reuse local primary keys; old proposal attribution
            // is therefore no longer trustworthy and must not be reported.
            database.appSettingDao().delete(ProposalSourceMappingCodec.KEY)
        }
    }

    private suspend fun mergeInTransaction(preview: RestorePreview) {
        val data = preview.data
        val users = data.users ?: throw BackupFileException("备份数据不完整")
        val subjects = data.subjects ?: throw BackupFileException("备份数据不完整")
        val tasks = data.tasks ?: throw BackupFileException("备份数据不完整")
        val weeklyGoals = data.weeklyGoals ?: throw BackupFileException("备份数据不完整")
        val sessions = data.studySessions ?: throw BackupFileException("备份数据不完整")
        val events = data.studySessionEvents ?: throw BackupFileException("备份数据不完整")
        val diaries = data.diaries ?: throw BackupFileException("备份数据不完整")
        val appSettings = data.appSettings ?: throw BackupFileException("备份数据不完整")
        database.withTransaction {
            // INSERT OR IGNORE preserves all current B rows. The validated backup
            // guarantees its own relations; inserting parents first makes rows
            // missing from B available to imported children as well.
            database.userDao().insertAllIgnoring(users.map { it.toEntity() })
            database.subjectDao().insertAllIgnoring(subjects.map { it.toEntity() })
            database.taskDao().insertAllIgnoring(tasks.map { it.toEntity() })
            database.weeklyGoalDao().insertAllIgnoring(weeklyGoals.map { it.toEntity() })
            database.studySessionDao().insertAllSessionsIgnoring(sessions.map { it.toEntity() })
            database.studySessionDao().insertAllEventsIgnoring(events.map { it.toEntity() })
            database.diaryDao().insertAllIgnoring(diaries.map { it.toEntity() })
            // 防御性过滤：合并恢复同样不写入同步运行时状态或设备级 Provider 配置。
            database.appSettingDao().insertAllIgnoring(
                appSettings.filter { isBackupEligibleAppSetting(it.key) }.map { it.toEntity() }
            )
            // Merge can preserve current sync_* settings, but provenance belongs
            // to the pre-restore data and must be cleared after any restore.
            database.appSettingDao().delete(ProposalSourceMappingCodec.KEY)
        }
    }

    // --- Helpers ---

    private fun readAllBounded(input: InputStream): ByteArray {
        val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
        val out = ByteArrayOutputStream()
        var total = 0L
        while (true) {
            val read = input.read(buffer)
            if (read == -1) break
            total += read
            if (total > BackupProtocol.MAX_BACKUP_BYTES) {
                throw BackupFileException("备份文件超过 32 MiB 上限")
            }
            out.write(buffer, 0, read)
        }
        return out.toByteArray()
    }

    private fun userMessage(throwable: Throwable): String {
        return when (throwable) {
            is BackupFileException -> throwable.message ?: "备份文件不可用"
            is BackupBlockedException -> throwable.message ?: BLOCKED_MESSAGE
            else -> "备份操作失败，请重试"
        }
    }

    private fun logFailure(operation: String, throwable: Throwable) {
        Log.e(TAG, "$operation failed", throwable)
    }
}
