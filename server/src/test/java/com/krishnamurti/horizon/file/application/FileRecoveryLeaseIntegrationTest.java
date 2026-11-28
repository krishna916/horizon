package com.krishnamurti.horizon.file.application;

import static org.assertj.core.api.Assertions.assertThat;

import com.krishnamurti.horizon.TestcontainersConfiguration;
import com.krishnamurti.horizon.file.api.command.PrepareFileCommand;
import com.krishnamurti.horizon.file.api.model.FileDescriptor;
import com.krishnamurti.horizon.file.api.model.FileReference;
import com.krishnamurti.horizon.file.api.model.FileScope;
import com.krishnamurti.horizon.file.infrastructure.persistence.FileRecoveryPersistence;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;

@SpringBootTest
@Import({TestcontainersConfiguration.class, FileApplicationTestConfiguration.class})
class FileRecoveryLeaseIntegrationTest {
    @Autowired TestFileOwner owner;
    @Autowired FileTransactions transfers;
    @Autowired FileRecoveryTransactions recovery;
    @Autowired FileRecoveryPersistence persistence;
    @Autowired RecoveryClock clock;
    @Autowired JdbcTemplate jdbc;
    @Autowired com.krishnamurti.horizon.file.api.FileService files;
    @Autowired org.springframework.transaction.support.TransactionTemplate transaction;

    @BeforeEach
    void setup() {
        FilePrepareIntegrationTest.ensureUsers(jdbc);
    }

    private FileReference prepared() {
        var scope = new FileScope(71L, "notes", "a".repeat(64));
        var file =
                owner.prepare(
                        new PrepareFileCommand(
                                UUID.randomUUID(),
                                scope,
                                new FileDescriptor("x.txt", "text/plain", 1L, "b".repeat(64))));
        return new FileReference(file.fileId(), scope);
    }

    @Test
    void noDeleteClaimForLiveSelectedOrSelectablePending() {
        var file = prepared();
        var attempt = transfers.registerAttempt(file);
        assertThat(recovery.claimDelete(file.fileId(), attempt.attemptId())).isEmpty();
        transfers.recordAttempt(
                file,
                attempt.attemptId(),
                FileTransactions.AttemptResult.verified(1, "b".repeat(64)),
                com.krishnamurti.horizon.file.api.model.FileFormat.TXT);
        assertThat(recovery.claimDelete(file.fileId(), attempt.attemptId())).isEmpty();
        assertThat(
                        jdbc.queryForObject(
                                "SELECT cleanup_requested_at IS NULL FROM file_transfer_attempt"
                                        + " WHERE id=?",
                                Boolean.class,
                                attempt.attemptId()))
                .isTrue();
    }

    @Test
    void eligibleLegacyIntentWithNullNextDateIsDue() {
        var file = prepared();
        var attempt = transfers.registerAttempt(file);
        jdbc.update(
                "UPDATE file_transfer_attempt SET cleanup_requested_at=now() WHERE id=?",
                attempt.attemptId());
        assertThat(
                        persistence.findCandidates(
                                FileRecoveryPersistence.WorkKind.DELETE_ATTEMPT, clock.now(), 25))
                .anySatisfy(c -> assertThat(c.attemptId()).isEqualTo(attempt.attemptId()));
        assertThat(recovery.claimDelete(file.fileId(), attempt.attemptId())).isPresent();
    }

    @Test
    void claimSkipsFutureDueAndActiveLease() {
        var file = prepared();
        var attempt = transfers.registerAttempt(file);
        jdbc.update(
                "UPDATE file_transfer_attempt SET"
                    + " cleanup_requested_at=now(),next_cleanup_at=now()+interval '1 hour' WHERE"
                    + " id=?",
                attempt.attemptId());
        assertThat(recovery.claimDelete(file.fileId(), attempt.attemptId())).isEmpty();
        jdbc.update(
                "UPDATE file_transfer_attempt SET next_cleanup_at=now() WHERE id=?",
                attempt.attemptId());
        assertThat(recovery.claimDelete(file.fileId(), attempt.attemptId())).isPresent();
        assertThat(recovery.claimDelete(file.fileId(), attempt.attemptId())).isEmpty();
    }

    @Test
    void expiredLeaseReclaimedWithDifferentToken() {
        var file = prepared();
        var attempt = transfers.registerAttempt(file);
        jdbc.update(
                "UPDATE file_transfer_attempt SET cleanup_requested_at=now() WHERE id=?",
                attempt.attemptId());
        var first = recovery.claimDelete(file.fileId(), attempt.attemptId()).orElseThrow();
        jdbc.update(
                "UPDATE file_transfer_attempt SET cleanup_lease_until=now()-interval '1 second'"
                        + " WHERE id=?",
                attempt.attemptId());
        var second = recovery.claimDelete(file.fileId(), attempt.attemptId()).orElseThrow();
        assertThat(second.token()).isNotEqualTo(first.token());
        assertThat(
                        jdbc.queryForObject(
                                "SELECT cleanup_attempt_count FROM file_transfer_attempt WHERE"
                                        + " id=?",
                                Long.class,
                                attempt.attemptId()))
                .isEqualTo(2L);
        assertThat(
                        jdbc.queryForObject(
                                "SELECT write_settled_at IS NULL FROM file_transfer_attempt WHERE"
                                        + " id=?",
                                Boolean.class,
                                attempt.attemptId()))
                .isTrue();
    }

    @Test
    void expiredUnclaimedGetsDurableFenceAndAllAttemptsEligible() {
        var file = prepared();
        var attempt = transfers.registerAttempt(file);
        jdbc.update(
                "UPDATE file_metadata SET expires_at=created_at + interval '1 microsecond' WHERE"
                        + " id=?",
                file.fileId());
        assertThat(recovery.recordExpiry(file.fileId())).isTrue();
        var claim = recovery.claimDelete(file.fileId(), attempt.attemptId()).orElseThrow();
        assertThat(claim.settledAtClaim()).isFalse();
        assertThat(
                        jdbc.queryForObject(
                                "SELECT outcome FROM file_transfer_attempt WHERE id=?",
                                String.class,
                                attempt.attemptId()))
                .isEqualTo("UNKNOWN");
    }

    @Test
    void twoConcurrentClaimersOnlyOneValidLease() throws Exception {
        var file = prepared();
        var attempt = transfers.registerAttempt(file);
        jdbc.update(
                "UPDATE file_transfer_attempt SET cleanup_requested_at=now() WHERE id=?",
                attempt.attemptId());
        var start = new java.util.concurrent.CountDownLatch(1);
        try (var executor = java.util.concurrent.Executors.newFixedThreadPool(2)) {
            var first =
                    executor.submit(
                            () -> {
                                start.await();
                                return recovery.claimDelete(file.fileId(), attempt.attemptId());
                            });
            var second =
                    executor.submit(
                            () -> {
                                start.await();
                                return recovery.claimDelete(file.fileId(), attempt.attemptId());
                            });
            start.countDown();
            assertThat(
                            java.util.stream.Stream.of(
                                            first.get(10, java.util.concurrent.TimeUnit.SECONDS),
                                            second.get(10, java.util.concurrent.TimeUnit.SECONDS))
                                    .filter(java.util.Optional::isPresent)
                                    .count())
                    .isEqualTo(1);
        }
        assertThat(
                        jdbc.queryForObject(
                                "SELECT cleanup_attempt_count FROM file_transfer_attempt WHERE"
                                        + " id=?",
                                Long.class,
                                attempt.attemptId()))
                .isEqualTo(1L);
    }

    @Test
    void losingAttemptEligibleEvenWhenParentClaimed() {
        var file = prepared();
        var winner = transfers.registerAttempt(file);
        var loser = transfers.registerAttempt(file);
        transfers.recordAttempt(
                file,
                winner.attemptId(),
                FileTransactions.AttemptResult.verified(1, "b".repeat(64)),
                com.krishnamurti.horizon.file.api.model.FileFormat.TXT);
        owner.inTransaction(
                () ->
                        files.claim(
                                new com.krishnamurti.horizon.file.api.command.ClaimFileCommand(
                                        file)));
        assertThat(recovery.claimDelete(file.fileId(), loser.attemptId())).isPresent();
        assertThat(recovery.claimDelete(file.fileId(), winner.attemptId())).isEmpty();
    }

    @Test
    void parentWithoutAttemptsIsCompactionCandidate() {
        var file = prepared();
        owner.inTransaction(
                () -> {
                    files.requestCleanup(
                            new com.krishnamurti.horizon.file.api.command.CleanupFileCommand(file));
                    return null;
                });
        assertThat(
                        persistence.findCandidates(
                                FileRecoveryPersistence.WorkKind.COMPACT_FILE, clock.now(), 25))
                .anySatisfy(candidate -> assertThat(candidate.fileId()).isEqualTo(file.fileId()));
    }

    @Test
    void settledFailedWithoutIntentIsEligible() {
        var file = prepared();
        var attempt = transfers.registerAttempt(file);
        transfers.recordAttempt(
                file, attempt.attemptId(), FileTransactions.AttemptResult.failed(false), null);
        var claim = recovery.claimDelete(file.fileId(), attempt.attemptId()).orElseThrow();
        assertThat(claim.settledAtClaim()).isTrue();
        assertThat(
                        jdbc.queryForObject(
                                "SELECT cleanup_requested_at IS NOT NULL FROM file_transfer_attempt"
                                        + " WHERE id=?",
                                Boolean.class,
                                attempt.attemptId()))
                .isTrue();
    }

    @Test
    void boundedDiscoveryOrdersByDueThenUuid() {
        var first = prepared();
        var second = prepared();
        jdbc.update(
                "UPDATE file_metadata SET expires_at=created_at+interval '1 microsecond' WHERE id"
                        + " IN (?,?)",
                first.fileId(),
                second.fileId());
        var candidates =
                persistence.findCandidates(
                        FileRecoveryPersistence.WorkKind.EXPIRE_FILE, clock.now(), 1000);
        assertThat(candidates).extracting(FileRecoveryPersistence.Candidate::dueAt).isSorted();
        assertThat(candidates)
                .extracting(FileRecoveryPersistence.Candidate::fileId)
                .contains(first.fileId(), second.fileId());
        assertThat(
                        persistence.findCandidates(
                                FileRecoveryPersistence.WorkKind.EXPIRE_FILE, clock.now(), 1))
                .hasSize(1);
    }

    @Test
    void lockedCandidateDoesNotBlockOtherFileProgress() throws Exception {
        var blocked = prepared();
        var free = prepared();
        var blockedAttempt = transfers.registerAttempt(blocked);
        var freeAttempt = transfers.registerAttempt(free);
        jdbc.update(
                "UPDATE file_transfer_attempt SET cleanup_requested_at=now() WHERE id IN (?,?)",
                blockedAttempt.attemptId(),
                freeAttempt.attemptId());
        var locked = new java.util.concurrent.CountDownLatch(1);
        var release = new java.util.concurrent.CountDownLatch(1);
        try (var executor = java.util.concurrent.Executors.newSingleThreadExecutor()) {
            var held =
                    executor.submit(
                            () ->
                                    transaction.executeWithoutResult(
                                            status -> {
                                                jdbc.queryForObject(
                                                        "SELECT id FROM file_metadata WHERE id=?"
                                                                + " FOR UPDATE",
                                                        UUID.class,
                                                        blocked.fileId());
                                                locked.countDown();
                                                try {
                                                    if (!release.await(
                                                            10,
                                                            java.util.concurrent.TimeUnit.SECONDS))
                                                        throw new IllegalStateException(
                                                                "lock wait timeout");
                                                } catch (InterruptedException e) {
                                                    Thread.currentThread().interrupt();
                                                    throw new IllegalStateException(e);
                                                }
                                            }));
            assertThat(locked.await(10, java.util.concurrent.TimeUnit.SECONDS)).isTrue();
            assertThat(recovery.claimDelete(blocked.fileId(), blockedAttempt.attemptId()))
                    .isEmpty();
            assertThat(recovery.claimDelete(free.fileId(), freeAttempt.attemptId())).isPresent();
            release.countDown();
            held.get(10, java.util.concurrent.TimeUnit.SECONDS);
        } finally {
            release.countDown();
        }
    }
}
