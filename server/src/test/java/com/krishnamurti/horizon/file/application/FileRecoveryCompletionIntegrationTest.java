package com.krishnamurti.horizon.file.application;

import static org.assertj.core.api.Assertions.assertThat;

import com.krishnamurti.horizon.TestcontainersConfiguration;
import com.krishnamurti.horizon.file.api.command.PrepareFileCommand;
import com.krishnamurti.horizon.file.api.model.FileDescriptor;
import com.krishnamurti.horizon.file.api.model.FileReference;
import com.krishnamurti.horizon.file.api.model.FileScope;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;

@SpringBootTest
@Import({TestcontainersConfiguration.class, FileApplicationTestConfiguration.class})
class FileRecoveryCompletionIntegrationTest {
    @Autowired TestFileOwner owner;
    @Autowired FileTransactions transfers;
    @Autowired FileRecoveryTransactions recovery;
    @Autowired JdbcTemplate jdbc;
    @Autowired com.krishnamurti.horizon.file.api.FileService files;

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
    void ackUnsettledReschedulesOneHourWithoutConfirmation() {
        var file = prepared();
        var attempt = transfers.registerAttempt(file);
        jdbc.update(
                "UPDATE file_transfer_attempt SET cleanup_requested_at=now() WHERE id=?",
                attempt.attemptId());
        var claim = recovery.claimDelete(file.fileId(), attempt.attemptId()).orElseThrow();
        assertThat(recovery.completeDelete(claim, FileRecoveryTransactions.DeleteCompletion.ack()))
                .isEqualTo(FileRecoveryTransactions.CompletionDisposition.UNKNOWN_REVISIT);
        assertThat(
                        jdbc.queryForObject(
                                "SELECT cleanup_confirmed_at IS NULL AND object_key IS NOT NULL AND"
                                        + " next_cleanup_at > now()+interval '59 minutes' AND"
                                        + " cleanup_lease_token IS NULL FROM file_transfer_attempt"
                                        + " WHERE id=?",
                                Boolean.class,
                                attempt.attemptId()))
                .isTrue();
    }

    @Test
    void settlementRecordedAfterClaimRequiresFreshDelete() {
        var file = prepared();
        var attempt = transfers.registerAttempt(file);
        jdbc.update(
                "UPDATE file_transfer_attempt SET cleanup_requested_at=now() WHERE id=?",
                attempt.attemptId());
        var first = recovery.claimDelete(file.fileId(), attempt.attemptId()).orElseThrow();
        transfers.recordAttempt(
                file, attempt.attemptId(), FileTransactions.AttemptResult.failed(true), null);
        assertThat(recovery.completeDelete(first, FileRecoveryTransactions.DeleteCompletion.ack()))
                .isEqualTo(FileRecoveryTransactions.CompletionDisposition.UNKNOWN_REVISIT);
        assertThat(
                        jdbc.queryForObject(
                                "SELECT cleanup_confirmed_at IS NULL AND object_key IS NOT NULL AND"
                                    + " next_cleanup_at <= now() FROM file_transfer_attempt WHERE"
                                    + " id=?",
                                Boolean.class,
                                attempt.attemptId()))
                .isTrue();
        var second = recovery.claimDelete(file.fileId(), attempt.attemptId()).orElseThrow();
        assertThat(recovery.completeDelete(second, FileRecoveryTransactions.DeleteCompletion.ack()))
                .isEqualTo(FileRecoveryTransactions.CompletionDisposition.TERMINAL_CONFIRMED);
        assertThat(
                        jdbc.queryForObject(
                                "SELECT object_key IS NULL AND cleanup_confirmed_at IS NOT NULL"
                                        + " FROM file_transfer_attempt WHERE id=?",
                                Boolean.class,
                                attempt.attemptId()))
                .isTrue();
    }

    @Test
    void staleOrExpiredTokenCannotAlterFacts() {
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
        assertThat(recovery.completeDelete(first, FileRecoveryTransactions.DeleteCompletion.ack()))
                .isEqualTo(FileRecoveryTransactions.CompletionDisposition.STALE);
        assertThat(
                        jdbc.queryForObject(
                                "SELECT cleanup_lease_token FROM file_transfer_attempt WHERE id=?",
                                UUID.class,
                                attempt.attemptId()))
                .isEqualTo(second.token());
    }

    @Test
    void failedDeletePersistsRetryAndClearsLease() {
        var file = prepared();
        var attempt = transfers.registerAttempt(file);
        jdbc.update(
                "UPDATE file_transfer_attempt SET cleanup_requested_at=now() WHERE id=?",
                attempt.attemptId());
        var claim = recovery.claimDelete(file.fileId(), attempt.attemptId()).orElseThrow();
        assertThat(
                        recovery.completeDelete(
                                claim,
                                FileRecoveryTransactions.DeleteCompletion.failed(
                                        FileRecoveryTransactions.CleanupError.STORAGE_UNAVAILABLE)))
                .isEqualTo(FileRecoveryTransactions.CompletionDisposition.RETRY_SCHEDULED);
        assertThat(
                        jdbc.queryForObject(
                                "SELECT object_key IS NOT NULL AND cleanup_lease_token IS NULL AND"
                                    + " next_cleanup_at>now() AND consecutive_cleanup_failures=1"
                                    + " AND last_cleanup_error_code='STORAGE_UNAVAILABLE' FROM"
                                    + " file_transfer_attempt WHERE id=?",
                                Boolean.class,
                                attempt.attemptId()))
                .isTrue();
    }

    @Test
    void expiredNoAttemptParentPurges() {
        var file = prepared();
        jdbc.update(
                "UPDATE file_metadata SET expires_at=created_at+interval '1 microsecond' WHERE"
                        + " id=?",
                file.fileId());
        assertThat(recovery.recordExpiry(file.fileId())).isTrue();
        assertThat(recovery.compactFile(file.fileId())).isTrue();
        assertThat(
                        jdbc.queryForObject(
                                "SELECT purged_at IS NOT NULL AND original_filename IS NULL FROM"
                                        + " file_metadata WHERE id=?",
                                Boolean.class,
                                file.fileId()))
                .isTrue();
    }

    @Test
    void unknownRetainsDescriptorAndSelectedFkUntilAllAttemptsConfirmed() {
        var file = prepared();
        var winner = transfers.registerAttempt(file);
        var unknown = transfers.registerAttempt(file);
        transfers.recordAttempt(
                file,
                winner.attemptId(),
                FileTransactions.AttemptResult.verified(1, "b".repeat(64)),
                com.krishnamurti.horizon.file.api.model.FileFormat.TXT);
        owner.inTransaction(
                () -> {
                    files.requestCleanup(
                            new com.krishnamurti.horizon.file.api.command.CleanupFileCommand(file));
                    return null;
                });
        var first = recovery.claimDelete(file.fileId(), winner.attemptId()).orElseThrow();
        assertThat(recovery.completeDelete(first, FileRecoveryTransactions.DeleteCompletion.ack()))
                .isEqualTo(FileRecoveryTransactions.CompletionDisposition.TERMINAL_CONFIRMED);
        assertThat(recovery.compactFile(file.fileId())).isFalse();
        assertThat(
                        jdbc.queryForObject(
                                "SELECT selected_attempt_id=? AND original_filename IS NOT NULL AND"
                                        + " purged_at IS NULL FROM file_metadata WHERE id=?",
                                Boolean.class,
                                winner.attemptId(),
                                file.fileId()))
                .isTrue();
        var second = recovery.claimDelete(file.fileId(), unknown.attemptId()).orElseThrow();
        assertThat(recovery.completeDelete(second, FileRecoveryTransactions.DeleteCompletion.ack()))
                .isEqualTo(FileRecoveryTransactions.CompletionDisposition.UNKNOWN_REVISIT);
        assertThat(recovery.compactFile(file.fileId())).isFalse();
        transfers.recordAttempt(
                file, unknown.attemptId(), FileTransactions.AttemptResult.failed(true), null);
        var finalClaim = recovery.claimDelete(file.fileId(), unknown.attemptId()).orElseThrow();
        assertThat(
                        recovery.completeDelete(
                                finalClaim, FileRecoveryTransactions.DeleteCompletion.ack()))
                .isEqualTo(FileRecoveryTransactions.CompletionDisposition.TERMINAL_CONFIRMED);
        assertThat(recovery.compactFile(file.fileId())).isTrue();
        assertThat(
                        jdbc.queryForObject(
                                "SELECT purged_at IS NOT NULL AND selected_attempt_id IS NULL AND"
                                    + " original_filename IS NULL FROM file_metadata WHERE id=?",
                                Boolean.class,
                                file.fileId()))
                .isTrue();
    }

    @Test
    void retryCounterResetsOnAckButCumulativeCountRemains() {
        var file = prepared();
        var attempt = transfers.registerAttempt(file);
        jdbc.update(
                "UPDATE file_transfer_attempt SET cleanup_requested_at=now() WHERE id=?",
                attempt.attemptId());
        var first = recovery.claimDelete(file.fileId(), attempt.attemptId()).orElseThrow();
        recovery.completeDelete(
                first,
                FileRecoveryTransactions.DeleteCompletion.failed(
                        FileRecoveryTransactions.CleanupError.DELETE_FAILED));
        jdbc.update(
                "UPDATE file_transfer_attempt SET next_cleanup_at=now() WHERE id=?",
                attempt.attemptId());
        var second = recovery.claimDelete(file.fileId(), attempt.attemptId()).orElseThrow();
        assertThat(recovery.completeDelete(second, FileRecoveryTransactions.DeleteCompletion.ack()))
                .isEqualTo(FileRecoveryTransactions.CompletionDisposition.UNKNOWN_REVISIT);
        assertThat(recovery.completeDelete(second, FileRecoveryTransactions.DeleteCompletion.ack()))
                .isEqualTo(FileRecoveryTransactions.CompletionDisposition.STALE);
        assertThat(
                        jdbc.queryForObject(
                                "SELECT consecutive_cleanup_failures=0 AND cleanup_attempt_count=2"
                                        + " AND last_cleanup_error_code IS NULL FROM"
                                        + " file_transfer_attempt WHERE id=?",
                                Boolean.class,
                                attempt.attemptId()))
                .isTrue();
    }

    @Test
    void failureAfterSuccessfulDeleteBeforeCommitLeavesLeaseAndLocator() {
        var file = prepared();
        var attempt = transfers.registerAttempt(file);
        transfers.recordAttempt(
                file, attempt.attemptId(), FileTransactions.AttemptResult.failed(true), null);
        var claim = recovery.claimDelete(file.fileId(), attempt.attemptId()).orElseThrow();
        jdbc.execute(
                "CREATE FUNCTION reject_recovery_confirmation() RETURNS trigger LANGUAGE plpgsql AS"
                        + " $$ BEGIN IF NEW.cleanup_confirmed_at IS NOT NULL THEN RAISE EXCEPTION"
                        + " 'controlled rollback'; END IF; RETURN NEW; END $$");
        jdbc.execute(
                "CREATE TRIGGER reject_recovery_confirmation BEFORE UPDATE ON file_transfer_attempt"
                        + " FOR EACH ROW EXECUTE FUNCTION reject_recovery_confirmation()");
        try {
            org.assertj.core.api.Assertions.assertThatThrownBy(
                            () ->
                                    recovery.completeDelete(
                                            claim, FileRecoveryTransactions.DeleteCompletion.ack()))
                    .isInstanceOf(RuntimeException.class);
        } finally {
            jdbc.execute("DROP TRIGGER reject_recovery_confirmation ON file_transfer_attempt");
            jdbc.execute("DROP FUNCTION reject_recovery_confirmation()");
        }
        assertThat(
                        jdbc.queryForObject(
                                "SELECT object_key IS NOT NULL AND cleanup_confirmed_at IS NULL AND"
                                        + " cleanup_lease_token=? FROM file_transfer_attempt WHERE"
                                        + " id=?",
                                Boolean.class,
                                claim.token(),
                                attempt.attemptId()))
                .isTrue();
    }
}
