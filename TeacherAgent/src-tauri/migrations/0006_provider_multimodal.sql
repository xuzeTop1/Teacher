-- Migration 0006: Add multimodal fields to provider_configs
-- text_model: optional separate text model name
-- vision_model: optional vision/multimodal model name
-- supports_vision: whether this provider supports vision/multimodal input

ALTER TABLE provider_configs ADD COLUMN text_model TEXT;
ALTER TABLE provider_configs ADD COLUMN vision_model TEXT;
ALTER TABLE provider_configs ADD COLUMN supports_vision INTEGER NOT NULL DEFAULT 0;
