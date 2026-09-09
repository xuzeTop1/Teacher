package com.hxz.alerttime.app.data.local.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Upsert
import com.hxz.alerttime.app.data.local.entity.UserEntity
import kotlinx.coroutines.flow.Flow

@Dao
interface UserDao {
    @Query("SELECT * FROM users WHERE deleted_at IS NULL ORDER BY id LIMIT 1")
    fun observeDefaultUser(): Flow<UserEntity?>

    @Query("SELECT * FROM users WHERE deleted_at IS NULL ORDER BY id LIMIT 1")
    suspend fun getDefaultUser(): UserEntity?

    @Query("SELECT * FROM users WHERE id = :userId LIMIT 1")
    suspend fun getUser(userId: Long): UserEntity?

    @Query("SELECT COUNT(*) FROM users WHERE deleted_at IS NULL")
    suspend fun countActiveUsers(): Int

    /** Full snapshot including soft-deleted rows, for backup export. */
    @Query("SELECT * FROM users ORDER BY id")
    suspend fun exportAll(): List<UserEntity>

    @Query("DELETE FROM users")
    suspend fun deleteAll()

    @Insert(onConflict = OnConflictStrategy.ABORT)
    suspend fun insertAll(users: List<UserEntity>)

    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun insertAllIgnoring(users: List<UserEntity>)

    @Upsert
    suspend fun upsert(user: UserEntity): Long
}
