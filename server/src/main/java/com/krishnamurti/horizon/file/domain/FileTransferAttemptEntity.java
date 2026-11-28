package com.krishnamurti.horizon.file.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.Objects;
import java.util.UUID;
import lombok.Getter;
import lombok.Setter;

@Entity
@Table(name = "file_transfer_attempt")
@Getter
@Setter
public class FileTransferAttemptEntity {
    @Id
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;

    @Column(name = "file_id", nullable = false, updatable = false)
    private UUID fileId;

    @Column(name = "object_key", length = 512)
    private String objectKey;

    @Column(name = "expected_size_bytes")
    private Long expectedSizeBytes;

    @Column(name = "expected_sha256", length = 64)
    private String expectedSha256;

    @Enumerated(EnumType.STRING)
    @Column(name = "outcome", nullable = false, length = 32)
    private TransferOutcome outcome;

    @Column(name = "verified_size_bytes")
    private Long verifiedSizeBytes;

    @Column(name = "verified_sha256", length = 64)
    private String verifiedSha256;

    @Column(
            name = "created_at",
            nullable = false,
            updatable = false,
            columnDefinition = "timestamptz")
    private Instant createdAt;

    @Column(name = "verified_at", columnDefinition = "timestamptz")
    private Instant verifiedAt;

    @Column(name = "write_settled_at", columnDefinition = "timestamptz")
    private Instant writeSettledAt;

    @Column(name = "cleanup_requested_at", columnDefinition = "timestamptz")
    private Instant cleanupRequestedAt;

    @Column(name = "next_cleanup_at", columnDefinition = "timestamptz")
    private Instant nextCleanupAt;

    @Column(name = "cleanup_lease_token")
    private UUID cleanupLeaseToken;

    @Column(name = "cleanup_lease_until", columnDefinition = "timestamptz")
    private Instant cleanupLeaseUntil;

    @Column(name = "consecutive_cleanup_failures", nullable = false)
    private long consecutiveCleanupFailures;

    @Column(name = "last_cleanup_error_code", length = 64)
    private String lastCleanupErrorCode;

    @Column(name = "last_cleanup_attempt_at", columnDefinition = "timestamptz")
    private Instant lastCleanupAttemptAt;

    @Column(name = "cleanup_attempt_count", nullable = false)
    private long cleanupAttemptCount;

    @Column(name = "cleanup_confirmed_at", columnDefinition = "timestamptz")
    private Instant cleanupConfirmedAt;

    @Column(name = "updated_at", nullable = false, columnDefinition = "timestamptz")
    private Instant updatedAt;

    protected FileTransferAttemptEntity() {}

    public static FileTransferAttemptEntity createPending(
            UUID id,
            UUID fileId,
            String objectKey,
            long expectedSizeBytes,
            String expectedSha256,
            Instant createdAt) {
        FileTransferAttemptEntity attempt = new FileTransferAttemptEntity();
        attempt.id = Objects.requireNonNull(id);
        attempt.fileId = Objects.requireNonNull(fileId);
        attempt.objectKey = Objects.requireNonNull(objectKey);
        attempt.expectedSizeBytes = expectedSizeBytes;
        attempt.expectedSha256 = Objects.requireNonNull(expectedSha256);
        attempt.outcome = TransferOutcome.PENDING;
        attempt.createdAt = Objects.requireNonNull(createdAt);
        attempt.updatedAt = createdAt;
        return attempt;
    }
}
