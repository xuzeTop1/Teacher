PRAGMA foreign_keys = ON;

-- Preserve the server-side millisecond timestamp used to order snapshots.
-- Older rows are nullable and are backfilled only when SQLite can parse the
-- existing ISO-8601 received_at value.
ALTER TABLE sync_snapshots ADD COLUMN received_at_ms INTEGER;

UPDATE sync_snapshots
SET received_at_ms =
      CAST(strftime('%s', received_at) AS INTEGER) * 1000
      + CAST(substr(strftime('%f', received_at), 4, 3) AS INTEGER)
WHERE received_at_ms IS NULL
  AND strftime('%s', received_at) IS NOT NULL
  AND strftime('%f', received_at) IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sync_snapshots_device_received_at_ms
  ON sync_snapshots(device_id, received_at_ms DESC);
