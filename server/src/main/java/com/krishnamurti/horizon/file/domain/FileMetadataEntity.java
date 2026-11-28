package com.krishnamurti.horizon.file.domain;

import com.krishnamurti.horizon.file.api.model.FileFormat;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;
import lombok.Getter;
import lombok.Setter;

@Entity
@Table(name = "file_metadata")
@Getter
@Setter
public class FileMetadataEntity {
    @Id
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;

    @Column(name = "user_id", nullable = false, updatable = false)
    private Long userId;

    @Column(name = "workspace", nullable = false, updatable = false, length = 64)
    private String workspace;

    @Column(name = "idempotency_key", nullable = false, updatable = false)
    private UUID idempotencyKey;

    @Column(name = "binding_fingerprint", nullable = false, updatable = false, length = 64)
    private String bindingFingerprint;

    @Column(name = "request_fingerprint", nullable = false, updatable = false, length = 64)
    private String requestFingerprint;

    @Column(name = "fingerprint_version", nullable = false, updatable = false)
    private short fingerprintVersion;

    @Column(name = "original_filename", length = 255)
    private String originalFilename;

    @Column(name = "declared_content_type", length = 255)
    private String declaredContentType;

    @Enumerated(EnumType.STRING)
    @Column(name = "validated_format", length = 32)
    private FileFormat validatedFormat;

    @Column(name = "expected_size_bytes")
    private Long expectedSizeBytes;

    @Column(name = "expected_sha256", length = 64)
    private String expectedSha256;

    @Column(name = "selected_attempt_id")
    private UUID selectedAttemptId;

    @Column(
            name = "created_at",
            nullable = false,
            updatable = false,
            columnDefinition = "timestamptz")
    private Instant createdAt;

    @Column(name = "expires_at", nullable = false, columnDefinition = "timestamptz")
    private Instant expiresAt;

    @Column(name = "expiry_recorded_at", columnDefinition = "timestamptz")
    private Instant expiryRecordedAt;

    @Column(name = "claimed_at", columnDefinition = "timestamptz")
    private Instant claimedAt;

    @Column(name = "cleanup_requested_at", columnDefinition = "timestamptz")
    private Instant cleanupRequestedAt;

    @Column(name = "purged_at", columnDefinition = "timestamptz")
    private Instant purgedAt;

    @Column(name = "updated_at", nullable = false, columnDefinition = "timestamptz")
    private Instant updatedAt;

    protected FileMetadataEntity() {}

    public static FileMetadataEntity createReservation(
            UUID id,
            Long userId,
            String workspace,
            UUID idempotencyKey,
            String bindingFingerprint,
            String requestFingerprint,
            short fingerprintVersion,
            String originalFilename,
            String declaredContentType,
            Long expectedSizeBytes,
            String expectedSha256,
            Instant createdAt,
            Instant expiresAt) {
        FileMetadataEntity entity = new FileMetadataEntity();
        entity.id = id;
        entity.userId = userId;
        entity.workspace = workspace;
        entity.idempotencyKey = idempotencyKey;
        entity.bindingFingerprint = bindingFingerprint;
        entity.requestFingerprint = requestFingerprint;
        entity.fingerprintVersion = fingerprintVersion;
        entity.originalFilename = originalFilename;
        entity.declaredContentType = declaredContentType;
        entity.expectedSizeBytes = expectedSizeBytes;
        entity.expectedSha256 = expectedSha256;
        entity.createdAt = createdAt;
        entity.expiresAt = expiresAt;
        entity.updatedAt = createdAt;
        return entity;
    }
}
