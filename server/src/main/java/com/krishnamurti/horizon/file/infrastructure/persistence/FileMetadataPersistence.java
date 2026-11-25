package com.krishnamurti.horizon.file.infrastructure.persistence;

import com.krishnamurti.horizon.file.domain.FileMetadataEntity;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

@Repository
public class FileMetadataPersistence {
    private final JdbcTemplate jdbc;
    private final FileMetadataRepository repository;

    public FileMetadataPersistence(JdbcTemplate jdbc, FileMetadataRepository repository) {
        this.jdbc = jdbc;
        this.repository = repository;
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public FileMetadataEntity insertOrFind(FileMetadataEntity candidate) {
        jdbc.update(
                "INSERT INTO file_metadata (id, user_id, workspace, idempotency_key,"
                        + " binding_fingerprint, request_fingerprint, fingerprint_version,"
                        + " original_filename, declared_content_type, expected_size_bytes,"
                        + " expected_sha256, created_at, expires_at, updated_at)"
                        + " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
                        + " ON CONFLICT (idempotency_key) DO NOTHING",
                candidate.getId(),
                candidate.getUserId(),
                candidate.getWorkspace(),
                candidate.getIdempotencyKey(),
                candidate.getBindingFingerprint(),
                candidate.getRequestFingerprint(),
                candidate.getFingerprintVersion(),
                candidate.getOriginalFilename(),
                candidate.getDeclaredContentType(),
                candidate.getExpectedSizeBytes(),
                candidate.getExpectedSha256(),
                OffsetDateTime.ofInstant(candidate.getCreatedAt(), ZoneOffset.UTC),
                OffsetDateTime.ofInstant(candidate.getExpiresAt(), ZoneOffset.UTC),
                OffsetDateTime.ofInstant(candidate.getUpdatedAt(), ZoneOffset.UTC));
        return repository
                .findByIdempotencyKey(candidate.getIdempotencyKey())
                .orElseThrow(
                        () ->
                                new IllegalStateException(
                                        "File reservation was not visible after insert-or-find"));
    }
}
