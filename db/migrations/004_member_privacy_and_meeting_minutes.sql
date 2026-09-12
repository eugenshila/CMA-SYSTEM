-- =============================================================================
-- 004 — Member privacy boundaries and secretary meeting-minutes workflow.
--
-- Members retain self-service access, but must not receive the directory-level
-- `members.view` permission. Meeting minutes may be transcribed from a scanned
-- handwritten source, reviewed, exported and shared through an expiring link.
-- =============================================================================

-- Ordinary members must not be able to browse the member directory or profiles.
-- Existing installations already received the original seed grants, therefore
-- this explicit revocation is required in addition to the seed correction.
DELETE FROM role_permissions rp
USING roles r, permissions p
WHERE rp.role_id = r.id
  AND rp.permission_id = p.id
  AND r.key = 'member'
  AND p.key = 'members.view';

-- Keep the original handwritten/typed source alongside the reviewed minutes.
ALTER TABLE meetings
  ADD COLUMN IF NOT EXISTS minutes_file_name VARCHAR(240),
  ADD COLUMN IF NOT EXISTS minutes_file_url TEXT,
  ADD COLUMN IF NOT EXISTS minutes_file_mime_type VARCHAR(120),
  ADD COLUMN IF NOT EXISTS minutes_file_size_bytes BIGINT,
  ADD COLUMN IF NOT EXISTS minutes_ocr_status VARCHAR(24) NOT NULL DEFAULT 'not_uploaded'
    CHECK (minutes_ocr_status IN ('not_uploaded', 'processing', 'completed', 'needs_review', 'not_configured', 'failed')),
  ADD COLUMN IF NOT EXISTS minutes_ocr_provider VARCHAR(48),
  ADD COLUMN IF NOT EXISTS minutes_ocr_error VARCHAR(320),
  ADD COLUMN IF NOT EXISTS minutes_updated_by BIGINT REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS minutes_updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS minutes_published_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS minutes_published_by BIGINT REFERENCES users(id);

-- Links are deliberately separate from authentication. A token is stored as a
-- one-way hash so leaked database data cannot be used to retrieve a document.
CREATE TABLE IF NOT EXISTS meeting_minutes_shares (
  id            BIGSERIAL PRIMARY KEY,
  meeting_id    BIGINT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  token_hash    CHAR(64) NOT NULL UNIQUE,
  created_by    BIGINT REFERENCES users(id),
  expires_at    TIMESTAMPTZ NOT NULL,
  revoked_at    TIMESTAMPTZ,
  access_count  INTEGER NOT NULL DEFAULT 0,
  last_accessed_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_meeting_minutes_shares_active
  ON meeting_minutes_shares(meeting_id, expires_at)
  WHERE revoked_at IS NULL;

-- The OCR integration is optional. `generic` expects a POST multipart request
-- with a `file` field and a JSON response containing `text` (or `data.text`).
INSERT INTO system_settings (key, value, group_name, description, is_secret)
VALUES (
  'minutes_ocr',
  '{"provider":"none","api_url":"","api_key":""}'::jsonb,
  'meetings',
  'Optional OCR provider for scanned handwritten meeting minutes. Google Cloud Vision and a generic multipart OCR endpoint are supported.',
  TRUE
)
ON CONFLICT (key) DO NOTHING;
