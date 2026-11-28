ALTER TABLE file_metadata ADD COLUMN expiry_recorded_at TIMESTAMPTZ;
ALTER TABLE file_transfer_attempt
  ADD COLUMN next_cleanup_at TIMESTAMPTZ,
  ADD COLUMN cleanup_lease_token UUID,
  ADD COLUMN cleanup_lease_until TIMESTAMPTZ,
  ADD COLUMN consecutive_cleanup_failures BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN last_cleanup_error_code VARCHAR(64);
ALTER TABLE file_metadata ADD CONSTRAINT ck_file_recovery_expiry_fact CHECK (
  expiry_recorded_at IS NULL OR (claimed_at IS NULL AND expiry_recorded_at >= expires_at));
ALTER TABLE file_transfer_attempt
  ADD CONSTRAINT ck_file_recovery_lease_pair CHECK (
    (cleanup_lease_token IS NULL) = (cleanup_lease_until IS NULL)),
  ADD CONSTRAINT ck_file_recovery_failures CHECK (consecutive_cleanup_failures >= 0),
  ADD CONSTRAINT ck_file_recovery_lease_requires_intent CHECK (
    cleanup_lease_token IS NULL OR (cleanup_requested_at IS NOT NULL AND object_key IS NOT NULL)),
  ADD CONSTRAINT ck_file_recovery_schedule_requires_intent CHECK (
    next_cleanup_at IS NULL OR (cleanup_requested_at IS NOT NULL AND object_key IS NOT NULL)),
  ADD CONSTRAINT ck_file_recovery_terminal CHECK (cleanup_confirmed_at IS NULL OR (
    cleanup_requested_at IS NOT NULL AND write_settled_at IS NOT NULL
    AND cleanup_confirmed_at >= cleanup_requested_at
    AND next_cleanup_at IS NULL AND cleanup_lease_token IS NULL AND cleanup_lease_until IS NULL));
CREATE INDEX idx_file_recovery_expiry ON file_metadata(expires_at,id)
  WHERE claimed_at IS NULL AND cleanup_requested_at IS NULL
    AND expiry_recorded_at IS NULL AND purged_at IS NULL;
CREATE INDEX idx_file_recovery_due ON file_transfer_attempt
  ((COALESCE(next_cleanup_at,cleanup_requested_at)),id)
  WHERE cleanup_requested_at IS NOT NULL AND cleanup_confirmed_at IS NULL AND object_key IS NOT NULL;
CREATE INDEX idx_file_recovery_lease ON file_transfer_attempt(cleanup_lease_until,id)
  WHERE cleanup_lease_token IS NOT NULL;
CREATE INDEX idx_file_recovery_unfenced ON file_transfer_attempt(file_id,created_at,id)
  WHERE cleanup_requested_at IS NULL AND cleanup_confirmed_at IS NULL AND object_key IS NOT NULL;
CREATE INDEX idx_file_recovery_parent_terminal ON file_metadata
  ((COALESCE(cleanup_requested_at,expiry_recorded_at)),id)
  WHERE purged_at IS NULL AND (cleanup_requested_at IS NOT NULL OR expiry_recorded_at IS NOT NULL);
