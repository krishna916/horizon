package com.krishnamurti.horizon.file.infrastructure.persistence;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.krishnamurti.horizon.TestcontainersConfiguration;
import com.krishnamurti.horizon.file.domain.FileMetadataEntity;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

@SpringBootTest(properties = "spring.jpa.hibernate.ddl-auto=validate")
@Import(TestcontainersConfiguration.class)
class FilePersistenceIntegrationTest {
    private static final long MAX_BYTES = 104_857_600L;
    private static final String DIGEST = "a".repeat(64);

    @Autowired private JdbcTemplate jdbc;
    @Autowired private FileMetadataPersistence fileMetadataPersistence;
    @Autowired private FileMetadataRepository fileMetadataRepository;
    @Autowired private PlatformTransactionManager transactionManager;

    @Test
    void schemaMigratesAndHibernateValidates() {
        assertThat(tableExists("file_metadata")).isTrue();
        assertThat(tableExists("file_transfer_attempt")).isTrue();
        assertThat(constraintExists("fk_file_metadata_selected_attempt")).isTrue();
        assertThat(indexExists("idx_file_metadata_expiry")).isTrue();
        assertThat(indexExists("idx_file_transfer_attempt_unresolved")).isTrue();
    }

    @Test
    void idempotencyKeyIsGloballyUnique() {
        UUID key = UUID.randomUUID();
        insertFile(UUID.randomUUID(), newUser(), key, "sample.txt", MAX_BYTES);
        assertThatThrownBy(() -> insertFile(UUID.randomUUID(), newUser(), key, "other.txt", 1))
                .isInstanceOf(DataIntegrityViolationException.class);
    }

    @Test
    void conflictSafeInsertReturnsExistingIdentityWithoutAbortingTransaction() {
        long user = newUser();
        UUID idempotencyKey = UUID.randomUUID();
        FileMetadataEntity first = metadata(UUID.randomUUID(), user, idempotencyKey, "first.txt");
        FileMetadataEntity duplicate =
                metadata(UUID.randomUUID(), user, idempotencyKey, "second.txt");
        TransactionTemplate transaction = new TransactionTemplate(transactionManager);

        FileMetadataEntity[] results =
                transaction.execute(
                        status ->
                                new FileMetadataEntity[] {
                                    fileMetadataPersistence.insertOrFind(first),
                                    fileMetadataPersistence.insertOrFind(duplicate)
                                });

        assertThat(results).isNotNull();
        assertThat(results[0].getId()).isEqualTo(first.getId());
        assertThat(results[1].getId()).isEqualTo(first.getId());
        assertThat(
                        jdbc.queryForObject(
                                "SELECT COUNT(*) FROM file_metadata WHERE idempotency_key = ?",
                                Integer.class,
                                idempotencyKey))
                .isEqualTo(1);
    }

    @Test
    void crossFileSelectedAttemptIsRejected() {
        long user = newUser();
        UUID first = UUID.randomUUID();
        UUID second = UUID.randomUUID();
        UUID attempt = UUID.randomUUID();
        OffsetDateTime now = now();
        insertFile(first, user, UUID.randomUUID(), "a.txt", 1);
        insertFile(second, user, UUID.randomUUID(), "b.txt", 1);
        insertAttempt(attempt, first, "users/1/notes/" + attempt, now);

        assertThatThrownBy(
                        () ->
                                jdbc.update(
                                        "UPDATE file_metadata SET selected_attempt_id = ? WHERE id"
                                                + " = ?",
                                        attempt,
                                        second))
                .isInstanceOf(DataIntegrityViolationException.class);
    }

    @Test
    void invalidShaAndOutcomeAreRejected() {
        UUID file = UUID.randomUUID();
        insertFile(file, newUser(), UUID.randomUUID(), "a.txt", 1);
        assertThatThrownBy(
                        () ->
                                jdbc.update(
                                        "UPDATE file_metadata SET expected_sha256 = ? WHERE id = ?",
                                        "A".repeat(64),
                                        file))
                .isInstanceOf(DataIntegrityViolationException.class);

        UUID attempt = UUID.randomUUID();
        insertAttempt(attempt, file, "users/1/notes/" + attempt, now());
        assertThatThrownBy(
                        () ->
                                jdbc.update(
                                        "UPDATE file_transfer_attempt SET outcome = 'NOT_A_STATE'"
                                                + " WHERE id = ?",
                                        attempt))
                .isInstanceOf(DataIntegrityViolationException.class);
    }

    @Test
    void hardCeilingIsInclusive() {
        insertFile(UUID.randomUUID(), newUser(), UUID.randomUUID(), "max.bin", MAX_BYTES);
        assertThatThrownBy(
                        () ->
                                insertFile(
                                        UUID.randomUUID(),
                                        newUser(),
                                        UUID.randomUUID(),
                                        "too-large.bin",
                                        MAX_BYTES + 1))
                .isInstanceOf(DataIntegrityViolationException.class);
    }

    @Test
    void activeMetadataCannotBeNull() {
        UUID id = UUID.randomUUID();
        long user = newUser();
        OffsetDateTime now = now();
        assertThatThrownBy(
                        () ->
                                jdbc.update(
                                        "INSERT INTO file_metadata"
                                            + " (id,user_id,workspace,idempotency_key,binding_fingerprint,request_fingerprint,fingerprint_version,original_filename,declared_content_type,expected_size_bytes,expected_sha256,created_at,expires_at,updated_at)"
                                            + " VALUES (?,?,?,?,?,?,1,?,NULL,1,?,?,?,?)",
                                        id,
                                        user,
                                        "notes",
                                        UUID.randomUUID(),
                                        DIGEST,
                                        DIGEST,
                                        "a.txt",
                                        DIGEST,
                                        now,
                                        now.plusHours(1),
                                        now))
                .isInstanceOf(DataIntegrityViolationException.class);
    }

    @Test
    void unsettledAttemptCannotLoseLocator() {
        UUID file = UUID.randomUUID();
        insertFile(file, newUser(), UUID.randomUUID(), "a.txt", 1);
        UUID attempt = UUID.randomUUID();
        insertAttempt(attempt, file, "users/1/notes/" + attempt, now());
        assertThatThrownBy(
                        () ->
                                jdbc.update(
                                        "UPDATE file_transfer_attempt SET object_key = NULL WHERE"
                                                + " id = ?",
                                        attempt))
                .isInstanceOf(DataIntegrityViolationException.class);
    }

    @Test
    void cleanupConfirmationRequiresSettledWrite() {
        UUID file = UUID.randomUUID();
        insertFile(file, newUser(), UUID.randomUUID(), "a.txt", 1);
        UUID attempt = UUID.randomUUID();
        insertAttempt(attempt, file, "users/1/notes/" + attempt, now());
        assertThatThrownBy(
                        () ->
                                jdbc.update(
                                        "UPDATE file_transfer_attempt SET cleanup_confirmed_at = ?"
                                                + " WHERE id = ?",
                                        now(),
                                        attempt))
                .isInstanceOf(DataIntegrityViolationException.class);
    }

    @Test
    void verifiedAttemptRequiresNonNullMatchingVerificationFacts() {
        OffsetDateTime now = now();
        for (String assignment :
                new String[] {
                    "verified_size_bytes=NULL",
                    "verified_sha256=NULL",
                    "verified_size_bytes=NULL, verified_sha256=NULL",
                    "verified_size_bytes=2",
                    "verified_sha256='b" + "b".repeat(63) + "'"
                }) {
            UUID file = UUID.randomUUID();
            insertFile(file, newUser(), UUID.randomUUID(), "a.txt", 1);
            UUID attempt = UUID.randomUUID();
            insertAttempt(attempt, file, "users/1/notes/" + attempt, now);
            jdbc.update(
                    "UPDATE file_transfer_attempt SET outcome='VERIFIED', verified_size_bytes=1,"
                            + " verified_sha256=?, verified_at=?, write_settled_at=?, updated_at=?"
                            + " WHERE id=?",
                    DIGEST,
                    now,
                    now,
                    now,
                    attempt);

            assertThatThrownBy(
                            () ->
                                    jdbc.update(
                                            "UPDATE file_transfer_attempt SET "
                                                    + assignment
                                                    + " WHERE id=?",
                                            attempt))
                    .isInstanceOf(DataIntegrityViolationException.class);
        }
    }

    @Test
    void claimedVerifiedAttemptCanBePurgedOnlyAsSettledHistoryTombstone() {
        UUID file = UUID.randomUUID();
        long user = newUser();
        UUID attempt = UUID.randomUUID();
        insertFile(file, user, UUID.randomUUID(), "a.txt", 1);
        OffsetDateTime now = now().plusSeconds(2);
        insertAttempt(attempt, file, "users/1/notes/" + attempt, now);
        jdbc.update(
                "UPDATE file_transfer_attempt SET outcome='VERIFIED', verified_size_bytes=1,"
                        + " verified_sha256=?, verified_at=?, write_settled_at=?, updated_at=?"
                        + " WHERE id=?",
                DIGEST,
                now,
                now,
                now,
                attempt);
        jdbc.update(
                "UPDATE file_metadata SET selected_attempt_id=?, validated_format='TEXT',"
                        + " claimed_at=?, updated_at=? WHERE id=?",
                attempt,
                now,
                now,
                file);

        jdbc.update(
                "UPDATE file_transfer_attempt SET cleanup_requested_at=?,"
                        + " cleanup_confirmed_at=?, object_key=NULL, expected_size_bytes=NULL,"
                        + " expected_sha256=NULL, verified_size_bytes=NULL, verified_sha256=NULL,"
                        + " updated_at=? WHERE id=?",
                now,
                now,
                now,
                attempt);
        jdbc.update(
                "UPDATE file_metadata SET original_filename=NULL, declared_content_type=NULL,"
                        + " validated_format=NULL, expected_size_bytes=NULL, expected_sha256=NULL,"
                        + " selected_attempt_id=NULL, purged_at=?, updated_at=? WHERE id=?",
                now,
                now,
                file);

        assertThat(
                        jdbc.queryForObject(
                                "SELECT claimed_at IS NOT NULL AND purged_at IS NOT NULL"
                                        + " FROM file_metadata WHERE id=?",
                                Boolean.class,
                                file))
                .isTrue();
        assertThat(
                        jdbc.queryForObject(
                                "SELECT outcome='VERIFIED' AND object_key IS NULL"
                                        + " AND expected_size_bytes IS NULL"
                                        + " AND verified_size_bytes IS NULL"
                                        + " FROM file_transfer_attempt WHERE id=?",
                                Boolean.class,
                                attempt))
                .isTrue();
        assertThatThrownBy(() -> insertAttempt(attempt, file, "users/1/notes/reused", now))
                .isInstanceOf(DataIntegrityViolationException.class);
    }

    @Test
    void userDeletionDoesNotCascade() {
        long user = newUser();
        insertFile(UUID.randomUUID(), user, UUID.randomUUID(), "a.txt", 1);
        assertThatThrownBy(() -> jdbc.update("DELETE FROM users WHERE id = ?", user))
                .isInstanceOf(DataIntegrityViolationException.class);
    }

    @Test
    void purgedFactsAllowMinimalTombstoneWithoutReusingAttemptId() {
        UUID file = UUID.randomUUID();
        long user = newUser();
        insertFile(file, user, UUID.randomUUID(), "a.txt", 1);
        UUID attempt = UUID.randomUUID();
        OffsetDateTime now = now();
        insertAttempt(attempt, file, "users/1/notes/" + attempt, now);
        jdbc.update(
                "UPDATE file_transfer_attempt SET write_settled_at = ?, cleanup_confirmed_at = ?,"
                        + " updated_at = ? WHERE id = ?",
                now,
                now,
                now,
                attempt);
        jdbc.update(
                "UPDATE file_metadata SET original_filename=NULL, declared_content_type=NULL,"
                    + " expected_size_bytes=NULL, expected_sha256=NULL, selected_attempt_id=NULL,"
                    + " purged_at=?, updated_at=? WHERE id=?",
                now,
                now,
                file);
        assertThat(
                        jdbc.queryForObject(
                                "SELECT COUNT(*) FROM file_transfer_attempt WHERE id = ?",
                                Integer.class,
                                attempt))
                .isEqualTo(1);
        assertThatThrownBy(() -> insertAttempt(attempt, file, "users/1/notes/reused", now))
                .isInstanceOf(DataIntegrityViolationException.class);
    }

    @Test
    void rowLocksSerializeMutation() throws Exception {
        UUID file = UUID.randomUUID();
        insertFile(file, newUser(), UUID.randomUUID(), "a.txt", 1);
        CountDownLatch waiterStarted = new CountDownLatch(1);
        CountDownLatch waiterAcquired = new CountDownLatch(1);
        AtomicReference<Future<UUID>> waiter = new AtomicReference<>();
        ExecutorService executor = Executors.newSingleThreadExecutor();
        TransactionTemplate transaction = new TransactionTemplate(transactionManager);
        try {
            transaction.executeWithoutResult(
                    status -> {
                        assertThat(fileMetadataRepository.lockById(file)).isPresent();
                        waiter.set(
                                executor.submit(
                                        () ->
                                                transaction.execute(
                                                        ignored -> {
                                                            waiterStarted.countDown();
                                                            UUID locked =
                                                                    fileMetadataRepository
                                                                            .lockById(file)
                                                                            .orElseThrow()
                                                                            .getId();
                                                            waiterAcquired.countDown();
                                                            return locked;
                                                        })));
                        try {
                            assertThat(waiterStarted.await(5, TimeUnit.SECONDS)).isTrue();
                            assertThat(waiterAcquired.await(200, TimeUnit.MILLISECONDS)).isFalse();
                        } catch (InterruptedException exception) {
                            Thread.currentThread().interrupt();
                            throw new IllegalStateException(
                                    "Interrupted while verifying row lock", exception);
                        }
                    });
            assertThat(waiterAcquired.await(5, TimeUnit.SECONDS)).isTrue();
            assertThat(waiter.get().get(5, TimeUnit.SECONDS)).isEqualTo(file);
        } finally {
            executor.shutdownNow();
        }
    }

    private long newUser() {
        return jdbc.queryForObject(
                "INSERT INTO users(email,password_hash,first_name,last_name,created_at,updated_at)"
                        + " VALUES (?,?,?,?,?,?) RETURNING id",
                Long.class,
                UUID.randomUUID() + "@test.invalid",
                "not-a-real-password-hash",
                "Test",
                "User",
                now(),
                now());
    }

    private FileMetadataEntity metadata(UUID id, long user, UUID idempotencyKey, String filename) {
        java.time.Instant createdAt = java.time.Instant.now();
        return FileMetadataEntity.createReservation(
                id,
                user,
                "notes",
                idempotencyKey,
                DIGEST,
                DIGEST,
                (short) 1,
                filename,
                "text/plain",
                1L,
                DIGEST,
                createdAt,
                createdAt.plusSeconds(86_400));
    }

    private void insertFile(UUID id, long user, UUID idempotencyKey, String filename, long size) {
        OffsetDateTime now = now();
        jdbc.update(
                "INSERT INTO file_metadata"
                    + " (id,user_id,workspace,idempotency_key,binding_fingerprint,request_fingerprint,fingerprint_version,original_filename,declared_content_type,expected_size_bytes,expected_sha256,created_at,expires_at,updated_at)"
                    + " VALUES (?,?,?,?,?,?,1,?,'text/plain',?,?,?, ?,?)",
                id,
                user,
                "notes",
                idempotencyKey,
                DIGEST,
                DIGEST,
                filename,
                size,
                DIGEST,
                now,
                now.plusHours(24),
                now);
    }

    private void insertAttempt(UUID id, UUID file, String key, OffsetDateTime now) {
        jdbc.update(
                "INSERT INTO file_transfer_attempt"
                    + " (id,file_id,object_key,expected_size_bytes,expected_sha256,outcome,created_at,updated_at)"
                    + " VALUES (?,?,?,1,?,'PENDING',?,?)",
                id,
                file,
                key,
                DIGEST,
                now,
                now);
    }

    private boolean constraintExists(String constraint) {
        return Boolean.TRUE.equals(
                jdbc.queryForObject(
                        "SELECT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = ?)",
                        Boolean.class,
                        constraint));
    }

    private boolean indexExists(String index) {
        return Boolean.TRUE.equals(
                jdbc.queryForObject(
                        "SELECT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = ?)",
                        Boolean.class,
                        index));
    }

    private boolean tableExists(String table) {
        return Boolean.TRUE.equals(
                jdbc.queryForObject("SELECT to_regclass(?) IS NOT NULL", Boolean.class, table));
    }

    private static OffsetDateTime now() {
        return OffsetDateTime.now(ZoneOffset.UTC);
    }
}
