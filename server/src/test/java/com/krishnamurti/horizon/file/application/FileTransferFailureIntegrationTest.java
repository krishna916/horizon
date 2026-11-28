package com.krishnamurti.horizon.file.application;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.krishnamurti.horizon.TestcontainersConfiguration;
import com.krishnamurti.horizon.file.api.FileService;
import com.krishnamurti.horizon.file.api.command.PrepareFileCommand;
import com.krishnamurti.horizon.file.api.command.TransferFileCommand;
import com.krishnamurti.horizon.file.api.model.FileDescriptor;
import com.krishnamurti.horizon.file.api.model.FileReference;
import com.krishnamurti.horizon.file.api.model.FileScope;
import com.krishnamurti.horizon.file.api.model.TransferDisposition;
import com.krishnamurti.horizon.file.application.port.DeleteResult;
import com.krishnamurti.horizon.file.application.port.ObjectKey;
import com.krishnamurti.horizon.file.application.port.WriteResult;
import com.krishnamurti.horizon.file.domain.FileTransferAttemptEntity;
import com.krishnamurti.horizon.file.domain.TransferOutcome;
import com.krishnamurti.horizon.file.infrastructure.FileProperties;
import com.krishnamurti.horizon.file.infrastructure.persistence.FileTransferAttemptRepository;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;

@Import({TestcontainersConfiguration.class, FileApplicationTestConfiguration.class})
@SpringBootTest
class FileTransferFailureIntegrationTest {
    private static final byte[] VALID_WEBP = fixture("file/fixtures/static.webp");

    @Autowired private FileService files;
    @Autowired private TestFileOwner owner;
    @Autowired private RecordingObjectStorage storage;
    @Autowired private FileTransferAttemptRepository attempts;
    @Autowired private JdbcTemplate jdbc;
    @Autowired private FileProperties properties;
    @Autowired private FileTransactions transactions;

    @BeforeEach
    void resetFixture() {
        removeFaultTriggers();
        FilePrepareIntegrationTest.ensureUsers(jdbc);
        jdbc.update("update file_metadata set claimed_at = null, selected_attempt_id = null");
        jdbc.update("delete from file_transfer_attempt");
        jdbc.update("delete from file_metadata");
        storage.reset();
        properties.setMaxFileSize(org.springframework.util.unit.DataSize.ofBytes(20_971_519L));
    }

    @AfterEach
    void removeFaultTriggers() {
        jdbc.execute("drop trigger if exists reject_file_attempt_insert on file_transfer_attempt");
        jdbc.execute("drop trigger if exists reject_file_attempt_outcome on file_transfer_attempt");
        jdbc.execute("drop function if exists reject_file_attempt_change()");
    }

    @Test
    void databaseCommitFailureBeforePutMakesZeroNetworkWrites() {
        FileReference reference = preparedFile(scope(71L, "before-put"));
        jdbc.execute(
                """
                create function reject_file_attempt_change() returns trigger language plpgsql as $$
                begin
                    raise exception 'controlled attempt insert failure';
                end
                $$
                """);
        jdbc.execute(
                "create trigger reject_file_attempt_insert before insert on file_transfer_attempt"
                        + " for each row execute function reject_file_attempt_change()");

        assertThatThrownBy(() -> transfer(reference)).isInstanceOf(RuntimeException.class);

        assertThat(storage.putCount()).isZero();
        assertThat(attempts.findAllByFileIdOrderByCreatedAtAsc(reference.fileId())).isEmpty();
    }

    @Test
    void databaseFailureAfterSuccessfulPutPreservesCommittedLocator() {
        FileReference reference = preparedFile(scope(72L, "after-put"));
        jdbc.execute(
                """
                create function reject_file_attempt_change() returns trigger language plpgsql as $$
                begin
                    if new.outcome <> old.outcome then
                        raise exception 'controlled attempt outcome failure';
                    end if;
                    return new;
                end
                $$
                """);
        jdbc.execute(
                "create trigger reject_file_attempt_outcome before update on file_transfer_attempt"
                        + " for each row execute function reject_file_attempt_change()");

        assertThatThrownBy(() -> transfer(reference)).isInstanceOf(RuntimeException.class);

        assertThat(storage.putCount()).isEqualTo(1);
        FileTransferAttemptEntity pending =
                attempts.findAllByFileIdOrderByCreatedAtAsc(reference.fileId()).getFirst();
        assertThat(pending.getOutcome()).isEqualTo(TransferOutcome.PENDING);
        assertThat(pending.getObjectKey()).isNotBlank();
        assertThat(storage.head(new ObjectKey(pending.getObjectKey())).found()).isTrue();
        assertThat(
                        jdbc.queryForObject(
                                "select selected_attempt_id from file_metadata where id = ?",
                                UUID.class,
                                reference.fileId()))
                .isNull();
    }

    @Test
    void lostSuccessfulPutResponseRetainsUnknownLocatorWithoutSelectionOrGet() {
        FileReference reference = preparedFile(scope(73L, "lost-response"));
        storage.nextPutResult(WriteResult.UNKNOWN);

        var result = transfer(reference);

        assertThat(result.disposition()).isEqualTo(TransferDisposition.OUTCOME_UNKNOWN);
        FileTransferAttemptEntity unknown =
                attempts.findAllByFileIdOrderByCreatedAtAsc(reference.fileId()).getFirst();
        assertThat(unknown.getOutcome()).isEqualTo(TransferOutcome.UNKNOWN);
        assertThat(unknown.getObjectKey()).isNotBlank();
        assertThat(unknown.getWriteSettledAt()).isNull();
        assertThat(storage.head(new ObjectKey(unknown.getObjectKey())).found()).isTrue();
        assertThat(storage.getCount()).isZero();
        assertThat(selectedAttempt(reference.fileId())).isNull();
    }

    @Test
    void negativeHeadAndDeleteAcknowledgementDoNotSettleUnknownAttempt() {
        FileReference reference = preparedFile(scope(74L, "not-observed"));
        storage.nextPutResult(WriteResult.UNKNOWN);
        storage.doNotStoreNextPut();

        var result = transfer(reference);

        assertThat(result.disposition()).isEqualTo(TransferDisposition.OUTCOME_UNKNOWN);
        FileTransferAttemptEntity unknown =
                attempts.findAllByFileIdOrderByCreatedAtAsc(reference.fileId()).getFirst();
        ObjectKey key = new ObjectKey(unknown.getObjectKey());
        assertThat(storage.head(key).found()).isFalse();
        assertThat(storage.delete(key)).isEqualTo(DeleteResult.ACKNOWLEDGED);
        FileTransferAttemptEntity afterDelete = attempts.findById(unknown.getId()).orElseThrow();
        assertThat(afterDelete.getOutcome()).isEqualTo(TransferOutcome.UNKNOWN);
        assertThat(afterDelete.getWriteSettledAt()).isNull();
        assertThat(afterDelete.getObjectKey()).isEqualTo(key.value());
        assertThat(selectedAttempt(reference.fileId())).isNull();
    }

    @Test
    void retryUsesDifferentKeyAndFirstVerifiedCommitWins() {
        FileReference reference = preparedFile(scope(75L, "new-attempt"));
        storage.nextPutResult(WriteResult.UNKNOWN);
        assertThat(transfer(reference).disposition())
                .isEqualTo(TransferDisposition.OUTCOME_UNKNOWN);
        String uncertainKey =
                attempts.findAllByFileIdOrderByCreatedAtAsc(reference.fileId())
                        .getFirst()
                        .getObjectKey();

        var retry = transfer(reference);

        assertThat(retry.disposition()).isEqualTo(TransferDisposition.VERIFIED);
        var rows = attempts.findAllByFileIdOrderByCreatedAtAsc(reference.fileId());
        assertThat(rows).hasSize(2);
        assertThat(rows.get(0).getObjectKey()).isNotEqualTo(rows.get(1).getObjectKey());
        assertThat(rows.get(0).getObjectKey()).isEqualTo(uncertainKey);
        assertThat(rows.get(0).getOutcome()).isEqualTo(TransferOutcome.UNKNOWN);
        assertThat(rows.get(0).getWriteSettledAt()).isNull();
        assertThat(rows.get(1).getOutcome()).isEqualTo(TransferOutcome.VERIFIED);
        assertThat(rows.get(1).getId()).isEqualTo(selectedAttempt(reference.fileId()));
        assertThat(storage.putCount()).isEqualTo(2);
    }

    @Test
    void duplicateSelectedCompletionDoesNotRequestCleanup() {
        FileReference reference = preparedFile(scope(75L, "duplicate-result"));
        transfer(reference);
        FileTransferAttemptEntity winner =
                attempts.findAllByFileIdOrderByCreatedAtAsc(reference.fileId()).getFirst();
        transactions.recordAttempt(
                reference,
                winner.getId(),
                FileTransactions.AttemptResult.verified(
                        winner.getVerifiedSizeBytes(), winner.getVerifiedSha256()),
                com.krishnamurti.horizon.file.api.model.FileFormat.WEBP);
        FileTransferAttemptEntity replayed = attempts.findById(winner.getId()).orElseThrow();
        assertThat(replayed.getCleanupRequestedAt()).isNull();
        assertThat(selectedAttempt(reference.fileId())).isEqualTo(winner.getId());
        assertThat(replayed.getWriteSettledAt()).isEqualTo(winner.getWriteSettledAt());
    }

    @Test
    void fencedLateVerifiedCompletionCannotSelect() {
        FileReference reference = preparedFile(scope(74L, "fenced-result"));
        var registration = transactions.registerAttempt(reference);
        jdbc.update(
                "UPDATE file_transfer_attempt SET cleanup_requested_at=now() WHERE id=?",
                registration.attemptId());
        transactions.recordAttempt(
                reference,
                registration.attemptId(),
                FileTransactions.AttemptResult.verified(
                        (long) VALID_WEBP.length, sha256(VALID_WEBP)),
                com.krishnamurti.horizon.file.api.model.FileFormat.WEBP);
        assertThat(selectedAttempt(reference.fileId())).isNull();
        var attempt = attempts.findById(registration.attemptId()).orElseThrow();
        assertThat(attempt.getWriteSettledAt()).isNotNull();
        assertThat(attempt.getNextCleanupAt()).isNotNull();
    }

    @Test
    void staleUnknownCannotDowngradeSettledOutcome() {
        FileReference reference = preparedFile(scope(73L, "stale-result"));
        transfer(reference);
        FileTransferAttemptEntity winner =
                attempts.findAllByFileIdOrderByCreatedAtAsc(reference.fileId()).getFirst();
        transactions.recordAttempt(
                reference, winner.getId(), FileTransactions.AttemptResult.unknown(), null);
        FileTransferAttemptEntity after = attempts.findById(winner.getId()).orElseThrow();
        assertThat(after.getOutcome()).isEqualTo(TransferOutcome.VERIFIED);
        assertThat(after.getWriteSettledAt()).isEqualTo(winner.getWriteSettledAt());
        assertThat(after.getCleanupRequestedAt()).isNull();
    }

    @Test
    void recordedExpirySurvivesClockRollbackAndDeniesRegistration() {
        FileReference reference = preparedFile(scope(72L, "recorded-expiry"));
        jdbc.update(
                "UPDATE file_metadata SET expiry_recorded_at=expires_at WHERE id=?",
                reference.fileId());
        assertThat(
                        files.inspect(
                                        new com.krishnamurti.horizon.file.api.query
                                                .InspectFileQuery(reference))
                                .lifecycle())
                .isEqualTo(com.krishnamurti.horizon.file.api.model.FileLifecycle.EXPIRED);
        assertThatThrownBy(() -> transactions.registerAttempt(reference))
                .isInstanceOf(com.krishnamurti.horizon.file.api.FileOperationException.class);
    }

    @Test
    void lateSettlementMakesFencedAttemptDueWithoutReplacingLease() {
        FileReference reference = preparedFile(scope(71L, "settlement-lease"));
        var registration = transactions.registerAttempt(reference);
        UUID token = UUID.randomUUID();
        jdbc.update(
                "UPDATE file_transfer_attempt SET cleanup_requested_at=now(),"
                        + " next_cleanup_at=now()+interval '1 hour', cleanup_lease_token=?,"
                        + " cleanup_lease_until=now()+interval '10 minutes' WHERE id=?",
                token,
                registration.attemptId());
        transactions.recordAttempt(
                reference,
                registration.attemptId(),
                FileTransactions.AttemptResult.verified(
                        (long) VALID_WEBP.length, sha256(VALID_WEBP)),
                com.krishnamurti.horizon.file.api.model.FileFormat.WEBP);
        var attempt = attempts.findById(registration.attemptId()).orElseThrow();
        assertThat(attempt.getCleanupLeaseToken()).isEqualTo(token);
        assertThat(attempt.getNextCleanupAt()).isBefore(attempt.getCleanupLeaseUntil());
        assertThat(selectedAttempt(reference.fileId())).isNull();
    }

    @Test
    void compactedAttemptCannotRestoreLocatorOrDigest() {
        FileReference reference = preparedFile(scope(71L, "compacted-result"));
        transfer(reference);
        UUID winner = selectedAttempt(reference.fileId());
        jdbc.update(
                "UPDATE file_metadata SET cleanup_requested_at=now() WHERE id=?",
                reference.fileId());
        jdbc.update(
                "UPDATE file_transfer_attempt SET cleanup_requested_at=now(),"
                    + " cleanup_confirmed_at=now(), object_key=NULL, expected_size_bytes=NULL,"
                    + " expected_sha256=NULL, verified_size_bytes=NULL, verified_sha256=NULL WHERE"
                    + " id=?",
                winner);
        transactions.recordAttempt(
                reference,
                winner,
                FileTransactions.AttemptResult.verified(
                        (long) VALID_WEBP.length, sha256(VALID_WEBP)),
                com.krishnamurti.horizon.file.api.model.FileFormat.WEBP);
        var attempt = attempts.findById(winner).orElseThrow();
        assertThat(attempt.getObjectKey()).isNull();
        assertThat(attempt.getExpectedSha256()).isNull();
        assertThat(attempt.getVerifiedSha256()).isNull();
    }

    private UUID selectedAttempt(UUID fileId) {
        return jdbc.queryForObject(
                "select selected_attempt_id from file_metadata where id = ?", UUID.class, fileId);
    }

    private com.krishnamurti.horizon.file.api.model.TransferResult transfer(
            FileReference reference) {
        return files.transfer(
                new TransferFileCommand(
                        reference, VALID_WEBP.length, new ByteArrayInputStream(VALID_WEBP)));
    }

    private FileReference preparedFile(FileScope scope) {
        var prepared =
                owner.prepare(
                        new PrepareFileCommand(
                                UUID.randomUUID(),
                                scope,
                                new FileDescriptor(
                                        "chart.webp",
                                        "image/webp",
                                        VALID_WEBP.length,
                                        sha256(VALID_WEBP))));
        return new FileReference(prepared.fileId(), scope);
    }

    private static FileScope scope(long userId, String binding) {
        try {
            String fingerprint =
                    HexFormat.of()
                            .formatHex(
                                    MessageDigest.getInstance("SHA-256")
                                            .digest(binding.getBytes(StandardCharsets.UTF_8)));
            return new FileScope(userId, "notes", fingerprint);
        } catch (java.security.NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    private static byte[] fixture(String path) {
        try (InputStream input =
                FileTransferFailureIntegrationTest.class
                        .getClassLoader()
                        .getResourceAsStream(path)) {
            if (input == null) throw new IllegalStateException("Missing fixture: " + path);
            return input.readAllBytes();
        } catch (IOException e) {
            throw new IllegalStateException(e);
        }
    }

    private static String sha256(byte[] bytes) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
        } catch (java.security.NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }
}
