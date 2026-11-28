package com.krishnamurti.horizon.file.application;

import static org.assertj.core.api.Assertions.assertThat;

import com.krishnamurti.horizon.TestcontainersConfiguration;
import com.krishnamurti.horizon.file.api.command.PrepareFileCommand;
import com.krishnamurti.horizon.file.api.model.FileDescriptor;
import com.krishnamurti.horizon.file.api.model.FileReference;
import com.krishnamurti.horizon.file.api.model.FileScope;
import com.krishnamurti.horizon.file.infrastructure.FileProperties;
import com.krishnamurti.horizon.file.infrastructure.FileRecoveryMetrics;
import com.krishnamurti.horizon.file.infrastructure.persistence.FileRecoveryPersistence;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.support.TransactionSynchronizationManager;

@SpringBootTest(properties = "test.recovery.worker.context=true")
@Import({TestcontainersConfiguration.class, FileApplicationTestConfiguration.class})
class FileRecoveryWorkerIntegrationTest {
    @Autowired FileRecoveryWorker worker;
    @Autowired FileTransactions transfers;
    @Autowired TestFileOwner owner;
    @Autowired RecordingObjectStorage storage;
    @Autowired FileProperties properties;
    @Autowired FileRecoveryTransactions recoveryTransactions;
    @Autowired FileRecoveryPersistence persistence;
    @Autowired RecoveryClock clock;
    @Autowired FileRecoveryMetrics recoveryMetrics;
    @Autowired JdbcTemplate jdbc;
    @Autowired com.krishnamurti.horizon.file.api.FileService files;

    @BeforeEach
    void reset() {
        FilePrepareIntegrationTest.ensureUsers(jdbc);
        jdbc.update("UPDATE file_metadata SET claimed_at=NULL,selected_attempt_id=NULL");
        jdbc.update("DELETE FROM file_transfer_attempt");
        jdbc.update("DELETE FROM file_metadata");
        storage.reset();
        properties.getRecovery().setBatchSize(25);
    }

    @Test
    void stopBeforePollPreventsCandidateAdmissionAndStopIsIdempotent() {
        var file = prepared();
        var attempt = transfers.registerAttempt(file);
        jdbc.update(
                "UPDATE file_transfer_attempt SET cleanup_requested_at=now() WHERE id=?",
                attempt.attemptId());
        var stoppingWorker =
                new FileRecoveryWorker(
                        persistence,
                        recoveryTransactions,
                        storage,
                        clock,
                        properties,
                        recoveryMetrics);

        stoppingWorker.stopAcceptingWork();
        stoppingWorker.stopAcceptingWork();
        stoppingWorker.runCycle();

        assertThat(storage.deleteCount()).isZero();
        assertThat(
                        jdbc.queryForObject(
                                "SELECT cleanup_lease_token IS NULL AND object_key IS NOT NULL"
                                        + " AND cleanup_confirmed_at IS NULL FROM"
                                        + " file_transfer_attempt WHERE id=?",
                                Boolean.class,
                                attempt.attemptId()))
                .isTrue();
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
    void pollProcessesExpiredAndRemovedFiles() {
        var file = prepared();
        jdbc.update(
                "UPDATE file_metadata SET expires_at=created_at+interval '1 microsecond' WHERE"
                        + " id=?",
                file.fileId());
        worker.runCycle();
        worker.runCycle();
        assertThat(
                        jdbc.queryForObject(
                                "SELECT purged_at IS NOT NULL AND expiry_recorded_at IS NOT NULL"
                                        + " FROM file_metadata WHERE id=?",
                                Boolean.class,
                                file.fileId()))
                .isTrue();
        assertThat(storage.deleteCount()).isZero();
    }

    @Test
    void noRemoteIoWithinTransactionAndUnsettledLocatorSurvives() {
        var file = prepared();
        var attempt = transfers.registerAttempt(file);
        jdbc.update(
                "UPDATE file_transfer_attempt SET cleanup_requested_at=now() WHERE id=?",
                attempt.attemptId());
        storage.deleteHook(
                key -> {
                    assertThat(TransactionSynchronizationManager.isActualTransactionActive())
                            .isFalse();
                    assertThat(
                                    jdbc.queryForObject(
                                            "SELECT cleanup_lease_token IS NOT NULL FROM"
                                                    + " file_transfer_attempt WHERE id=?",
                                            Boolean.class,
                                            attempt.attemptId()))
                            .isTrue();
                });
        worker.runCycle();
        assertThat(storage.deleteCount()).isEqualTo(1);
        assertThat(
                        jdbc.queryForObject(
                                "SELECT object_key IS NOT NULL AND cleanup_confirmed_at IS NULL AND"
                                        + " next_cleanup_at>now() FROM file_transfer_attempt WHERE"
                                        + " id=?",
                                Boolean.class,
                                attempt.attemptId()))
                .isTrue();
    }

    @Test
    void localOverlappingPollIsIgnoredAndOneLeaseImmediatelyBeforeEachDelete() throws Exception {
        var first = prepared();
        var second = prepared();
        var a = transfers.registerAttempt(first);
        var b = transfers.registerAttempt(second);
        jdbc.update(
                "UPDATE file_transfer_attempt SET cleanup_requested_at=now() WHERE id IN (?,?)",
                a.attemptId(),
                b.attemptId());
        var entered = new CountDownLatch(1);
        var release = new CountDownLatch(1);
        storage.deleteHook(
                key -> {
                    entered.countDown();
                    try {
                        if (!release.await(10, TimeUnit.SECONDS))
                            throw new IllegalStateException("timeout");
                    } catch (InterruptedException e) {
                        Thread.currentThread().interrupt();
                        throw new IllegalStateException(e);
                    }
                });
        try (var executor = Executors.newSingleThreadExecutor()) {
            var running = executor.submit(worker::runCycle);
            assertThat(entered.await(10, TimeUnit.SECONDS)).isTrue();
            worker.runCycle();
            assertThat(storage.deleteCount()).isEqualTo(1);
            assertThat(
                            jdbc.queryForObject(
                                    "SELECT count(*) FROM file_transfer_attempt WHERE"
                                            + " cleanup_lease_token IS NOT NULL",
                                    Long.class))
                    .isEqualTo(1L);
            release.countDown();
            running.get(10, TimeUnit.SECONDS);
        } finally {
            release.countDown();
        }
        assertThat(storage.deleteCount()).isEqualTo(2);
    }

    @Test
    void cycleProcessesAtMostConfiguredBatch() {
        properties.getRecovery().setBatchSize(2);
        for (int i = 0; i < 3; i++) {
            var f = prepared();
            var a = transfers.registerAttempt(f);
            jdbc.update(
                    "UPDATE file_transfer_attempt SET cleanup_requested_at=now() WHERE id=?",
                    a.attemptId());
        }
        worker.runCycle();
        assertThat(storage.deleteCount()).isEqualTo(2);
    }

    @Test
    void rotatingKindsAvoidStarvationUnderUnknownBacklog() {
        properties.getRecovery().setBatchSize(1);
        var expired = prepared();
        jdbc.update(
                "UPDATE file_metadata SET expires_at=created_at+interval '1 microsecond' WHERE"
                        + " id=?",
                expired.fileId());
        var pending = prepared();
        var attempt = transfers.registerAttempt(pending);
        jdbc.update(
                "UPDATE file_transfer_attempt SET cleanup_requested_at=now() WHERE id=?",
                attempt.attemptId());
        var compactable = prepared();
        owner.inTransaction(
                () -> {
                    files.requestCleanup(
                            new com.krishnamurti.horizon.file.api.command.CleanupFileCommand(
                                    compactable));
                    return null;
                });
        worker.runCycle();
        worker.runCycle();
        worker.runCycle();
        assertThat(
                        jdbc.queryForObject(
                                "SELECT expiry_recorded_at IS NOT NULL FROM file_metadata WHERE"
                                        + " id=?",
                                Boolean.class,
                                expired.fileId()))
                .isTrue();
        assertThat(
                        jdbc.queryForObject(
                                "SELECT cleanup_attempt_count FROM file_transfer_attempt WHERE"
                                        + " id=?",
                                Long.class,
                                attempt.attemptId()))
                .isEqualTo(1L);
        assertThat(
                        jdbc.queryForObject(
                                "SELECT purged_at IS NOT NULL FROM file_metadata WHERE id=?",
                                Boolean.class,
                                compactable.fileId()))
                .isTrue();
    }

    @Test
    void interruptionAfterDeleteLeavesLeaseForRecovery() throws Exception {
        var file = prepared();
        var attempt = transfers.registerAttempt(file);
        jdbc.update(
                "UPDATE file_transfer_attempt SET cleanup_requested_at=now() WHERE id=?",
                attempt.attemptId());
        storage.deleteHook(key -> Thread.currentThread().interrupt());
        try (var executor = Executors.newSingleThreadExecutor()) {
            executor.submit(worker::runCycle).get(10, TimeUnit.SECONDS);
        }
        assertThat(
                        jdbc.queryForObject(
                                "SELECT cleanup_lease_token IS NOT NULL AND object_key IS NOT NULL"
                                        + " FROM file_transfer_attempt WHERE id=?",
                                Boolean.class,
                                attempt.attemptId()))
                .isTrue();
    }

    @Test
    void logicalRemovalCommitsBeforeNetworkDelete() {
        var file = prepared();
        var attempt = transfers.registerAttempt(file);
        org.assertj.core.api.Assertions.assertThatThrownBy(
                        () ->
                                owner.inTransaction(
                                        () -> {
                                            files.requestCleanup(
                                                    new com.krishnamurti.horizon.file.api.command
                                                            .CleanupFileCommand(file));
                                            org.assertj.core.api.Assertions.assertThatThrownBy(
                                                            worker::runCycle)
                                                    .isInstanceOf(
                                                            org.springframework.transaction
                                                                    .IllegalTransactionStateException
                                                                    .class);
                                            throw new IllegalStateException("rollback");
                                        }))
                .isInstanceOf(IllegalStateException.class);
        worker.runCycle();
        assertThat(storage.deleteCount()).isZero();
        owner.inTransaction(
                () -> {
                    files.requestCleanup(
                            new com.krishnamurti.horizon.file.api.command.CleanupFileCommand(file));
                    return null;
                });
        worker.runCycle();
        assertThat(storage.deleteCount()).isEqualTo(1);
        assertThat(
                        jdbc.queryForObject(
                                "SELECT object_key IS NOT NULL AND cleanup_requested_at IS NOT NULL"
                                        + " FROM file_transfer_attempt WHERE id=?",
                                Boolean.class,
                                attempt.attemptId()))
                .isTrue();
    }

    @Test
    void storageFailureSchedulesRetryWithoutHotLoop() {
        var file = prepared();
        var attempt = transfers.registerAttempt(file);
        jdbc.update(
                "UPDATE file_transfer_attempt SET cleanup_requested_at=now() WHERE id=?",
                attempt.attemptId());
        storage.deleteHook(
                key -> {
                    throw new com.krishnamurti.horizon.file.application.port.ObjectStorageException(
                            "sensitive test payload");
                });
        worker.runCycle();
        worker.runCycle();
        assertThat(storage.deleteCount()).isEqualTo(1);
        assertThat(
                        jdbc.queryForObject(
                                "SELECT last_cleanup_error_code='STORAGE_UNAVAILABLE' AND"
                                        + " next_cleanup_at>now() AND object_key IS NOT NULL FROM"
                                        + " file_transfer_attempt WHERE id=?",
                                Boolean.class,
                                attempt.attemptId()))
                .isTrue();
    }

    @Test
    void skipsUnexpiredAndClaimedWinner() {
        var pending = prepared();
        transfers.registerAttempt(pending);
        var live = prepared();
        var winner = transfers.registerAttempt(live);
        transfers.recordAttempt(
                live,
                winner.attemptId(),
                FileTransactions.AttemptResult.verified(1, "b".repeat(64)),
                com.krishnamurti.horizon.file.api.model.FileFormat.TXT);
        owner.inTransaction(
                () ->
                        files.claim(
                                new com.krishnamurti.horizon.file.api.command.ClaimFileCommand(
                                        live)));
        worker.runCycle();
        assertThat(storage.deleteCount()).isZero();
        assertThat(
                        jdbc.queryForObject(
                                "SELECT cleanup_requested_at IS NULL FROM file_transfer_attempt"
                                        + " WHERE id=?",
                                Boolean.class,
                                winner.attemptId()))
                .isTrue();
    }

    @Test
    void dbFailureDoesNotSpinOrLoseIntent() {
        var file = prepared();
        var attempt = transfers.registerAttempt(file);
        jdbc.update(
                "UPDATE file_transfer_attempt SET cleanup_requested_at=now() WHERE id=?",
                attempt.attemptId());
        jdbc.execute(
                "CREATE FUNCTION reject_worker_lease() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN"
                        + " IF NEW.cleanup_lease_token IS NOT NULL THEN RAISE EXCEPTION 'test db"
                        + " failure'; END IF; RETURN NEW; END $$");
        jdbc.execute(
                "CREATE TRIGGER reject_worker_lease BEFORE UPDATE ON file_transfer_attempt FOR EACH"
                        + " ROW EXECUTE FUNCTION reject_worker_lease()");
        try {
            worker.runCycle();
        } finally {
            jdbc.execute("DROP TRIGGER reject_worker_lease ON file_transfer_attempt");
            jdbc.execute("DROP FUNCTION reject_worker_lease()");
        }
        assertThat(storage.deleteCount()).isZero();
        assertThat(
                        jdbc.queryForObject(
                                "SELECT cleanup_requested_at IS NOT NULL AND cleanup_lease_token IS"
                                    + " NULL AND object_key IS NOT NULL FROM file_transfer_attempt"
                                    + " WHERE id=?",
                                Boolean.class,
                                attempt.attemptId()))
                .isTrue();
        worker.runCycle();
        assertThat(storage.deleteCount()).isEqualTo(1);
    }
}
