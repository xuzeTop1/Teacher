-- Migration 0007: Add attachments_json to messages to persist multimodal attachments

ALTER TABLE messages ADD COLUMN attachments_json TEXT NOT NULL DEFAULT '[]';
