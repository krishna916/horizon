package com.krishnamurti.horizon.file.infrastructure.persistence;

import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class FileRecoveryPersistence {
    public enum WorkKind {
        EXPIRE_FILE,
        DELETE_ATTEMPT,
        COMPACT_FILE
    }

    public record Candidate(WorkKind kind, UUID fileId, UUID attemptId, Instant dueAt) {}

    private final JdbcTemplate jdbc;

    public FileRecoveryPersistence(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public boolean lockFileIfAvailable(UUID id) {
        return !jdbc.query(
                        "SELECT id FROM file_metadata WHERE id=? FOR UPDATE SKIP LOCKED",
                        (rs, n) -> rs.getObject(1, UUID.class),
                        id)
                .isEmpty();
    }

    public boolean hasUnconfirmedAttempts(UUID fileId) {
        return Boolean.TRUE.equals(
                jdbc.queryForObject(
                        "SELECT EXISTS (SELECT 1 FROM file_transfer_attempt WHERE file_id=? AND"
                            + " (cleanup_confirmed_at IS NULL OR object_key IS NOT NULL OR"
                            + " expected_size_bytes IS NOT NULL OR expected_sha256 IS NOT NULL OR"
                            + " verified_size_bytes IS NOT NULL OR verified_sha256 IS NOT NULL))",
                        Boolean.class,
                        fileId));
    }

    public List<Candidate> findCandidates(WorkKind kind, Instant now, int limit) {
        String sql =
                switch (kind) {
                    case EXPIRE_FILE ->
                            """
                            SELECT f.id AS file_id, NULL::uuid AS attempt_id, f.expires_at AS due_at
                            FROM file_metadata f WHERE f.claimed_at IS NULL AND f.cleanup_requested_at IS NULL
                              AND f.expiry_recorded_at IS NULL AND f.purged_at IS NULL AND f.expires_at <= ?
                            ORDER BY due_at, f.id LIMIT ?
                            """;
                    case COMPACT_FILE ->
                            """
                            SELECT f.id AS file_id, NULL::uuid AS attempt_id, COALESCE(f.cleanup_requested_at,f.expiry_recorded_at) AS due_at
                            FROM file_metadata f WHERE f.purged_at IS NULL
                              AND (f.cleanup_requested_at IS NOT NULL OR f.expiry_recorded_at IS NOT NULL)
                              AND NOT EXISTS (SELECT 1 FROM file_transfer_attempt a WHERE a.file_id=f.id AND
                                (a.cleanup_confirmed_at IS NULL OR a.object_key IS NOT NULL OR a.expected_size_bytes IS NOT NULL
                                OR a.expected_sha256 IS NOT NULL OR a.verified_size_bytes IS NOT NULL OR a.verified_sha256 IS NOT NULL))
                              AND COALESCE(f.cleanup_requested_at,f.expiry_recorded_at) <= ?
                            ORDER BY due_at, f.id LIMIT ?
                            """;
                    case DELETE_ATTEMPT ->
                            """
                            SELECT file_id, attempt_id, due_at FROM (
                              SELECT f.id AS file_id, a.id AS attempt_id, COALESCE(a.next_cleanup_at,a.cleanup_requested_at) AS due_at
                              FROM file_transfer_attempt a JOIN file_metadata f ON f.id=a.file_id
                              WHERE a.cleanup_requested_at IS NOT NULL AND a.cleanup_confirmed_at IS NULL AND a.object_key IS NOT NULL
                                AND f.purged_at IS NULL AND (a.cleanup_lease_until IS NULL OR a.cleanup_lease_until <= ?)
                                AND (f.selected_attempt_id IS DISTINCT FROM a.id OR f.cleanup_requested_at IS NOT NULL OR f.expiry_recorded_at IS NOT NULL OR (f.claimed_at IS NULL AND f.expires_at <= ?))
                              UNION ALL
                              SELECT f.id AS file_id, a.id AS attempt_id, a.created_at AS due_at
                              FROM file_transfer_attempt a JOIN file_metadata f ON f.id=a.file_id
                              WHERE a.cleanup_requested_at IS NULL AND a.cleanup_confirmed_at IS NULL AND a.object_key IS NOT NULL
                                AND f.purged_at IS NULL AND (a.cleanup_lease_until IS NULL OR a.cleanup_lease_until <= ?)
                                AND (f.cleanup_requested_at IS NOT NULL OR f.expiry_recorded_at IS NOT NULL
                                     OR (f.claimed_at IS NULL AND f.expires_at <= ?)
                                     OR (f.selected_attempt_id IS NOT NULL AND f.selected_attempt_id<>a.id)
                                     OR (a.outcome='FAILED' AND a.write_settled_at IS NOT NULL))
                                AND (f.selected_attempt_id IS DISTINCT FROM a.id OR f.cleanup_requested_at IS NOT NULL OR f.expiry_recorded_at IS NOT NULL OR (f.claimed_at IS NULL AND f.expires_at <= ?))
                            ) candidates WHERE due_at <= ? ORDER BY due_at,attempt_id LIMIT ?
                            """;
                };
        OffsetDateTime t = OffsetDateTime.ofInstant(now, ZoneOffset.UTC);
        Object[] args =
                kind == WorkKind.DELETE_ATTEMPT
                        ? new Object[] {t, t, t, t, t, t, limit}
                        : new Object[] {t, limit};
        return jdbc.query(
                sql,
                (rs, row) ->
                        new Candidate(
                                kind,
                                rs.getObject("file_id", UUID.class),
                                rs.getObject("attempt_id", UUID.class),
                                rs.getObject("due_at", OffsetDateTime.class).toInstant()),
                args);
    }
}
