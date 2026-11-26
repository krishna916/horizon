CREATE TABLE file_metadata (
    id UUID NOT NULL,
    user_id BIGINT NOT NULL,
    workspace VARCHAR(64) NOT NULL,
    idempotency_key UUID NOT NULL,
    binding_fingerprint VARCHAR(64) NOT NULL,
    request_fingerprint VARCHAR(64) NOT NULL,
    fingerprint_version SMALLINT NOT NULL,
    original_filename VARCHAR(255),
    declared_content_type VARCHAR(255),
    validated_format VARCHAR(32),
    expected_size_bytes BIGINT,
    expected_sha256 VARCHAR(64),
    selected_attempt_id UUID,
    created_at TIMESTAMPTZ NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    claimed_at TIMESTAMPTZ,
    cleanup_requested_at TIMESTAMPTZ,
    purged_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT pk_file_metadata PRIMARY KEY (id),
    CONSTRAINT uk_file_metadata_idempotency_key UNIQUE (idempotency_key),
    CONSTRAINT fk_file_metadata_users FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT,
    CONSTRAINT ck_file_metadata_binding_fingerprint CHECK (binding_fingerprint ~ '^[0-9a-f]{64}$'),
    CONSTRAINT ck_file_metadata_request_fingerprint CHECK (request_fingerprint ~ '^[0-9a-f]{64}$'),
    CONSTRAINT ck_file_metadata_fingerprint_version CHECK (fingerprint_version > 0),
    CONSTRAINT ck_file_metadata_expected_sha256 CHECK (expected_sha256 IS NULL OR expected_sha256 ~ '^[0-9a-f]{64}$'),
    CONSTRAINT ck_file_metadata_expected_size CHECK (expected_size_bytes IS NULL OR expected_size_bytes BETWEEN 1 AND 104857600),
    CONSTRAINT ck_file_metadata_lifetime CHECK (expires_at > created_at AND updated_at >= created_at),
    CONSTRAINT ck_file_metadata_claimed_at CHECK (
        claimed_at IS NULL
        OR (claimed_at >= created_at
            AND (purged_at IS NOT NULL OR (selected_attempt_id IS NOT NULL AND validated_format IS NOT NULL)))
    ),
    CONSTRAINT ck_file_metadata_cleanup_at CHECK (cleanup_requested_at IS NULL OR cleanup_requested_at >= created_at),
    CONSTRAINT ck_file_metadata_purged_at CHECK (purged_at IS NULL OR (purged_at >= created_at AND original_filename IS NULL AND declared_content_type IS NULL AND validated_format IS NULL AND expected_size_bytes IS NULL AND expected_sha256 IS NULL AND selected_attempt_id IS NULL)),
    CONSTRAINT ck_file_metadata_active_descriptor CHECK (purged_at IS NOT NULL OR (original_filename IS NOT NULL AND declared_content_type IS NOT NULL AND expected_size_bytes IS NOT NULL AND expected_sha256 IS NOT NULL))
);

CREATE TABLE file_transfer_attempt (
    id UUID NOT NULL,
    file_id UUID NOT NULL,
    object_key VARCHAR(512),
    expected_size_bytes BIGINT,
    expected_sha256 VARCHAR(64),
    outcome VARCHAR(32) NOT NULL,
    verified_size_bytes BIGINT,
    verified_sha256 VARCHAR(64),
    created_at TIMESTAMPTZ NOT NULL,
    verified_at TIMESTAMPTZ,
    write_settled_at TIMESTAMPTZ,
    cleanup_requested_at TIMESTAMPTZ,
    last_cleanup_attempt_at TIMESTAMPTZ,
    cleanup_attempt_count BIGINT NOT NULL DEFAULT 0,
    cleanup_confirmed_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT pk_file_transfer_attempt PRIMARY KEY (id),
    CONSTRAINT uk_file_transfer_attempt_file_id UNIQUE (file_id, id),
    CONSTRAINT uk_file_transfer_attempt_object_key UNIQUE (object_key),
    CONSTRAINT fk_file_transfer_attempt_file FOREIGN KEY (file_id) REFERENCES file_metadata (id) ON DELETE RESTRICT,
    CONSTRAINT ck_file_transfer_attempt_outcome CHECK (outcome IN ('PENDING', 'UNKNOWN', 'VERIFIED', 'FAILED')),
    CONSTRAINT ck_file_transfer_attempt_expected_size CHECK (expected_size_bytes IS NULL OR expected_size_bytes BETWEEN 1 AND 104857600),
    CONSTRAINT ck_file_transfer_attempt_verified_size CHECK (verified_size_bytes IS NULL OR verified_size_bytes BETWEEN 1 AND 104857600),
    CONSTRAINT ck_file_transfer_attempt_expected_sha256 CHECK (expected_sha256 IS NULL OR expected_sha256 ~ '^[0-9a-f]{64}$'),
    CONSTRAINT ck_file_transfer_attempt_verified_sha256 CHECK (verified_sha256 IS NULL OR verified_sha256 ~ '^[0-9a-f]{64}$'),
    CONSTRAINT ck_file_transfer_attempt_cleanup_count CHECK (cleanup_attempt_count >= 0),
    CONSTRAINT ck_file_transfer_attempt_times CHECK (
        updated_at >= created_at
        AND (verified_at IS NULL OR verified_at >= created_at)
        AND (write_settled_at IS NULL OR write_settled_at >= created_at)
        AND (cleanup_requested_at IS NULL OR cleanup_requested_at >= created_at)
        AND (last_cleanup_attempt_at IS NULL OR last_cleanup_attempt_at >= created_at)
        AND (cleanup_confirmed_at IS NULL OR (write_settled_at IS NOT NULL AND cleanup_confirmed_at >= write_settled_at))
    ),
    CONSTRAINT ck_file_transfer_attempt_verified CHECK (
        outcome <> 'VERIFIED'
        OR (
            (expected_size_bytes IS NOT NULL AND expected_sha256 IS NOT NULL
                AND verified_size_bytes IS NOT NULL AND verified_sha256 IS NOT NULL
                AND verified_size_bytes = expected_size_bytes AND verified_sha256 = expected_sha256
                AND verified_at IS NOT NULL AND write_settled_at IS NOT NULL)
            OR (write_settled_at IS NOT NULL AND cleanup_confirmed_at IS NOT NULL
                AND object_key IS NULL AND expected_size_bytes IS NULL AND expected_sha256 IS NULL
                AND verified_size_bytes IS NULL AND verified_sha256 IS NULL)
        )
    ),
    CONSTRAINT ck_file_transfer_attempt_failed_settled CHECK (outcome <> 'FAILED' OR write_settled_at IS NOT NULL),
    CONSTRAINT ck_file_transfer_attempt_locator_retained CHECK (
        (write_settled_at IS NOT NULL AND cleanup_confirmed_at IS NOT NULL) OR object_key IS NOT NULL
    ),
    CONSTRAINT ck_file_transfer_attempt_identity_retained CHECK (
        (write_settled_at IS NOT NULL AND cleanup_confirmed_at IS NOT NULL)
        OR (expected_size_bytes IS NOT NULL AND expected_sha256 IS NOT NULL)
    )
);

ALTER TABLE file_metadata
    ADD CONSTRAINT fk_file_metadata_selected_attempt
    FOREIGN KEY (id, selected_attempt_id)
    REFERENCES file_transfer_attempt (file_id, id)
    ON DELETE RESTRICT;

CREATE INDEX idx_file_metadata_user_id ON file_metadata (user_id);
CREATE INDEX idx_file_metadata_expiry
    ON file_metadata (expires_at)
    WHERE claimed_at IS NULL AND cleanup_requested_at IS NULL AND purged_at IS NULL;
CREATE INDEX idx_file_metadata_cleanup
    ON file_metadata (cleanup_requested_at)
    WHERE cleanup_requested_at IS NOT NULL AND purged_at IS NULL;
CREATE INDEX idx_file_transfer_attempt_unresolved
    ON file_transfer_attempt (created_at)
    WHERE outcome IN ('PENDING', 'UNKNOWN');
CREATE INDEX idx_file_transfer_attempt_cleanup
    ON file_transfer_attempt (cleanup_requested_at)
    WHERE cleanup_requested_at IS NOT NULL AND cleanup_confirmed_at IS NULL;
