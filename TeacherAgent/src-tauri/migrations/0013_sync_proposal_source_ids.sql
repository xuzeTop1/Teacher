PRAGMA foreign_keys = ON;

-- Preserve optional provenance from an AlertTime accepted proposal.
-- This is metadata only: the Teacher database does not require a local
-- proposal row to exist before importing a snapshot.
ALTER TABLE sync_weekly_goals ADD COLUMN source_proposal_id TEXT;
ALTER TABLE sync_tasks ADD COLUMN source_proposal_id TEXT;
