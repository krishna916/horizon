package com.krishnamurti.horizon.file.application;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.krishnamurti.horizon.TestcontainersConfiguration;
import com.krishnamurti.horizon.file.api.FileOperationException;
import com.krishnamurti.horizon.file.api.FileService;
import com.krishnamurti.horizon.file.api.command.ClaimFileCommand;
import com.krishnamurti.horizon.file.api.command.CleanupFileCommand;
import com.krishnamurti.horizon.file.api.command.TransferFileCommand;
import com.krishnamurti.horizon.file.api.model.FileDescriptor;
import com.krishnamurti.horizon.file.api.model.FileReference;
import com.krishnamurti.horizon.file.api.model.FileScope;
import com.krishnamurti.horizon.file.api.model.TransferDisposition;
import com.krishnamurti.horizon.file.api.query.ReadFileQuery;
import com.krishnamurti.horizon.file.application.port.StoredObject;
import com.krishnamurti.horizon.file.application.port.WriteResult;
import com.krishnamurti.horizon.file.domain.FileTransferAttemptEntity;
import com.krishnamurti.horizon.file.domain.TransferOutcome;
import com.krishnamurti.horizon.file.infrastructure.FileProperties;
import com.krishnamurti.horizon.file.infrastructure.persistence.FileTransferAttemptRepository;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.security.MessageDigest;
import java.sql.Timestamp;
import java.util.HexFormat;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.IllegalTransactionStateException;
import org.springframework.transaction.support.TransactionSynchronizationManager;

@Import({TestcontainersConfiguration.class, FileApplicationTestConfiguration.class})
@SpringBootTest
class FileTransferIntegrationTest {
    private static final byte[] VALID_WEBP = fixture("file/fixtures/static.webp");
    @Autowired private FileService files;
    @Autowired private TestFileOwner owner;
    @Autowired private RecordingObjectStorage storage;
    @Autowired private FileTransferAttemptRepository attempts;
    @Autowired private JdbcTemplate jdbc;
    @Autowired private FileProperties properties;

    @BeforeEach
    void resetFixtures() {
        FilePrepareIntegrationTest.ensureUsers(jdbc);
        jdbc.update("update file_metadata set claimed_at = null, selected_attempt_id = null");
        jdbc.update("delete from file_transfer_attempt");
        jdbc.update("delete from file_metadata");
        storage.reset();
        properties.setMaxFileSize(org.springframework.util.unit.DataSize.ofBytes(20_971_519L));
    }

    @Test
    void validatedTransferRegistersCommittedLocatorBeforePut() {
        var prepared = prepare(scope(81L, "note-a"), VALID_WEBP, "chart.webp");
        AtomicInteger committedPending = new AtomicInteger();
        storage.putHook(
                request -> {
                    assertThat(TransactionSynchronizationManager.isActualTransactionActive())
                            .isFalse();
                    String key = request.key().value();
                    UUID attemptId = UUID.fromString(key.substring(key.lastIndexOf('/') + 1));
                    FileTransferAttemptEntity row = attempts.findById(attemptId).orElseThrow();
                    assertThat(row.getOutcome()).isEqualTo(TransferOutcome.PENDING);
                    assertThat(row.getObjectKey()).isEqualTo(key);
                    committedPending.incrementAndGet();
                });

        var result = transfer(prepared.fileId(), scope(81L, "note-a"), VALID_WEBP);

        assertThat(result.disposition()).isEqualTo(TransferDisposition.VERIFIED);
        assertThat(result.file().metadata().validatedFormat())
                .isEqualTo(com.krishnamurti.horizon.file.api.model.FileFormat.WEBP);
        assertThat(committedPending).hasValue(1);
        assertThat(attempts.findAllByFileIdOrderByCreatedAtAsc(prepared.fileId()))
                .singleElement()
                .satisfies(
                        attempt -> {
                            assertThat(attempt.getOutcome()).isEqualTo(TransferOutcome.VERIFIED);
                            assertThat(attempt.getWriteSettledAt()).isNotNull();
                            assertThat(attempt.getVerifiedSha256()).isEqualTo(sha256(VALID_WEBP));
                        });
    }

    @Test
    void noPutOnInvalidOrOversizeBytes() {
        byte[] invalid = "not a webp".getBytes(java.nio.charset.StandardCharsets.UTF_8);
        var malformed = prepare(scope(82L, "note-a"), invalid, "chart.webp");
        assertThatThrownBy(() -> transfer(malformed.fileId(), scope(82L, "note-a"), invalid))
                .isInstanceOfSatisfying(
                        FileOperationException.class,
                        failure ->
                                assertThat(failure.reason())
                                        .isEqualTo(FileOperationException.Reason.INVALID_CONTENT));
        assertThat(storage.putCount()).isZero();
        assertThat(attempts.findAllByFileIdOrderByCreatedAtAsc(malformed.fileId())).isEmpty();

        var oversized = prepare(scope(83L, "note-a"), VALID_WEBP, "chart.webp");
        properties.setMaxFileSize(
                org.springframework.util.unit.DataSize.ofBytes(VALID_WEBP.length - 1L));
        assertThatThrownBy(() -> transfer(oversized.fileId(), scope(83L, "note-a"), VALID_WEBP))
                .isInstanceOfSatisfying(
                        FileOperationException.class,
                        failure ->
                                assertThat(failure.reason())
                                        .isEqualTo(
                                                FileOperationException.Reason.SIZE_LIMIT_EXCEEDED));
        assertThat(storage.putCount()).isZero();
        assertThat(attempts.findAllByFileIdOrderByCreatedAtAsc(oversized.fileId())).isEmpty();
    }

    @Test
    void verifiedResultRequiresMatchingRemoteGetDigest() {
        var prepared = prepare(scope(84L, "note-a"), VALID_WEBP, "chart.webp");
        storage.nextGetBytes(
                "different object bytes".getBytes(java.nio.charset.StandardCharsets.UTF_8));

        var result = transfer(prepared.fileId(), scope(84L, "note-a"), VALID_WEBP);

        assertThat(result.disposition()).isEqualTo(TransferDisposition.RETRYABLE_FAILURE);
        assertThat(result.file().metadata().validatedFormat()).isNull();
        assertThat(result.file().metadata().sha256()).isEqualTo(sha256(VALID_WEBP));
        assertThat(
                        jdbc.queryForObject(
                                "select selected_attempt_id from file_metadata where id = ?",
                                UUID.class,
                                prepared.fileId()))
                .isNull();
        assertThat(attempts.findAllByFileIdOrderByCreatedAtAsc(prepared.fileId()))
                .singleElement()
                .satisfies(
                        attempt -> {
                            assertThat(attempt.getOutcome()).isEqualTo(TransferOutcome.FAILED);
                            assertThat(attempt.getWriteSettledAt()).isNotNull();
                            assertThat(attempt.getCleanupRequestedAt()).isNotNull();
                        });
    }

    @Test
    void slowProgressVerificationIsAbortedAtOverallOperationDeadline() {
        var prepared = prepare(scope(89L, "slow-read"), VALID_WEBP, "chart.webp");
        properties.getStorage().getS3().setOperationTimeout(java.time.Duration.ofMillis(100));
        AtomicBoolean aborted = new AtomicBoolean();
        AtomicInteger abortCount = new AtomicInteger();
        storage.nextGetObject(
                () ->
                        new StoredObject(
                                new InputStream() {
                                    private int offset;

                                    @Override
                                    public int read() throws IOException {
                                        byte[] one = new byte[1];
                                        int read = read(one, 0, 1);
                                        return read < 0 ? -1 : Byte.toUnsignedInt(one[0]);
                                    }

                                    @Override
                                    public int read(byte[] bytes, int start, int length)
                                            throws IOException {
                                        if (aborted.get()) {
                                            throw new IOException("stream aborted");
                                        }
                                        try {
                                            Thread.sleep(15);
                                        } catch (InterruptedException exception) {
                                            Thread.currentThread().interrupt();
                                            throw new IOException("read interrupted", exception);
                                        }
                                        if (aborted.get()) {
                                            throw new IOException("stream aborted");
                                        }
                                        if (offset == VALID_WEBP.length) return -1;
                                        bytes[start] = VALID_WEBP[offset++];
                                        return 1;
                                    }
                                },
                                VALID_WEBP.length,
                                "image/webp",
                                () -> {
                                    abortCount.incrementAndGet();
                                    aborted.set(true);
                                }));

        var result = transfer(prepared.fileId(), scope(89L, "slow-read"), VALID_WEBP);

        assertThat(result.disposition()).isEqualTo(TransferDisposition.RETRYABLE_FAILURE);
        assertThat(abortCount).hasValue(1);
        assertThat(result.file().metadata().validatedFormat()).isNull();
        assertThat(attempts.findAllByFileIdOrderByCreatedAtAsc(prepared.fileId()))
                .singleElement()
                .satisfies(
                        attempt -> {
                            assertThat(attempt.getOutcome()).isEqualTo(TransferOutcome.FAILED);
                            assertThat(attempt.getWriteSettledAt()).isNotNull();
                        });
    }

    @Test
    void verifiedReplayChecksDeclaredLengthWithoutConsumingContentAfterLimitReduction() {
        var prepared = prepare(scope(89L, "replay"), VALID_WEBP, "chart.webp");
        assertThat(transfer(prepared.fileId(), scope(89L, "replay"), VALID_WEBP).disposition())
                .isEqualTo(TransferDisposition.VERIFIED);
        properties.setMaxFileSize(
                org.springframework.util.unit.DataSize.ofBytes(VALID_WEBP.length - 1L));
        AtomicInteger replayReads = new AtomicInteger();
        InputStream replayContent =
                new InputStream() {
                    @Override
                    public int read() {
                        replayReads.incrementAndGet();
                        return -1;
                    }

                    @Override
                    public int read(byte[] bytes, int offset, int length) {
                        replayReads.incrementAndGet();
                        return -1;
                    }
                };
        FileReference reference = new FileReference(prepared.fileId(), scope(89L, "replay"));

        var replay =
                files.transfer(
                        new TransferFileCommand(reference, VALID_WEBP.length, replayContent));
        assertThat(replay.disposition()).isEqualTo(TransferDisposition.ALREADY_VERIFIED);
        assertThat(replayReads).hasValue(0);
        assertThat(storage.putCount()).isEqualTo(1);

        assertThatThrownBy(
                        () ->
                                files.transfer(
                                        new TransferFileCommand(
                                                reference, VALID_WEBP.length - 1L, replayContent)))
                .isInstanceOfSatisfying(
                        FileOperationException.class,
                        failure ->
                                assertThat(failure.reason())
                                        .isEqualTo(FileOperationException.Reason.INVALID_METADATA));
        assertThat(replayReads).hasValue(0);
        assertThat(storage.putCount()).isEqualTo(1);
    }

    @Test
    void repeatVerifiedTransferDoesNotPutAgainOrConsumeReplayStream() {
        var prepared = prepare(scope(85L, "note-a"), VALID_WEBP, "chart.webp");
        assertThat(transfer(prepared.fileId(), scope(85L, "note-a"), VALID_WEBP).disposition())
                .isEqualTo(TransferDisposition.VERIFIED);
        AtomicInteger reads = new AtomicInteger();
        InputStream replay =
                new ByteArrayInputStream(VALID_WEBP) {
                    @Override
                    public synchronized int read(byte[] bytes, int offset, int length) {
                        reads.incrementAndGet();
                        return super.read(bytes, offset, length);
                    }
                };

        var result =
                files.transfer(
                        new TransferFileCommand(
                                new FileReference(prepared.fileId(), scope(85L, "note-a")),
                                VALID_WEBP.length,
                                replay));

        assertThat(result.disposition()).isEqualTo(TransferDisposition.ALREADY_VERIFIED);
        assertThat(storage.putCount()).isEqualTo(1);
        assertThat(reads).hasValue(0);
    }

    @Test
    void transferRejectsAmbientTransaction() {
        var prepared = prepare(scope(86L, "note-a"), VALID_WEBP, "chart.webp");
        assertThatThrownBy(
                        () ->
                                owner.inTransaction(
                                        () -> {
                                            files.transfer(
                                                    new TransferFileCommand(
                                                            new FileReference(
                                                                    prepared.fileId(),
                                                                    scope(86L, "note-a")),
                                                            VALID_WEBP.length,
                                                            new ByteArrayInputStream(VALID_WEBP)));
                                            return null;
                                        }))
                .isInstanceOf(IllegalTransactionStateException.class);
        assertThat(storage.putCount()).isZero();
    }

    @Test
    void uncertainStorageOutcomeKeepsDurableAttemptLocator() {
        var prepared = prepare(scope(87L, "note-a"), VALID_WEBP, "chart.webp");
        storage.nextPutResult(WriteResult.UNKNOWN);

        var result = transfer(prepared.fileId(), scope(87L, "note-a"), VALID_WEBP);

        assertThat(result.disposition()).isEqualTo(TransferDisposition.OUTCOME_UNKNOWN);
        FileTransferAttemptEntity attempt =
                attempts.findAllByFileIdOrderByCreatedAtAsc(prepared.fileId()).getFirst();
        assertThat(attempt.getObjectKey()).isNotBlank();
        assertThat(attempt.getOutcome()).isEqualTo(TransferOutcome.UNKNOWN);
        assertThat(attempt.getWriteSettledAt()).isNull();
        assertThat(attempt.getCleanupConfirmedAt()).isNull();
        assertThat(result.file().metadata().validatedFormat()).isNull();
    }

    @Test
    void unverifiedTransferAfterLimitReductionIsRejectedAndExpiryPreventsRegistration() {
        var limited = prepare(scope(88L, "note-a"), VALID_WEBP, "chart.webp");
        properties.setMaxFileSize(
                org.springframework.util.unit.DataSize.ofBytes(VALID_WEBP.length - 1L));
        assertThatThrownBy(() -> transfer(limited.fileId(), scope(88L, "note-a"), VALID_WEBP))
                .isInstanceOfSatisfying(
                        FileOperationException.class,
                        failure ->
                                assertThat(failure.reason())
                                        .isEqualTo(
                                                FileOperationException.Reason.SIZE_LIMIT_EXCEEDED));
        assertThat(attempts.findAllByFileIdOrderByCreatedAtAsc(limited.fileId())).isEmpty();
        properties.setMaxFileSize(org.springframework.util.unit.DataSize.ofBytes(20_971_519L));

        var expired = prepare(scope(89L, "note-a"), VALID_WEBP, "chart.webp");
        jdbc.update("update file_metadata set expires_at = now() where id = ?", expired.fileId());
        AtomicInteger reads = new AtomicInteger();
        InputStream unread =
                new InputStream() {
                    private final ByteArrayInputStream delegate =
                            new ByteArrayInputStream(VALID_WEBP);

                    @Override
                    public int read() {
                        reads.incrementAndGet();
                        return delegate.read();
                    }

                    @Override
                    public int read(byte[] bytes, int offset, int length) {
                        reads.incrementAndGet();
                        return delegate.read(bytes, offset, length);
                    }
                };
        assertThatThrownBy(
                        () ->
                                files.transfer(
                                        new TransferFileCommand(
                                                new FileReference(
                                                        expired.fileId(), scope(89L, "note-a")),
                                                VALID_WEBP.length,
                                                unread)))
                .isInstanceOfSatisfying(
                        FileOperationException.class,
                        failure ->
                                assertThat(failure.reason())
                                        .isEqualTo(FileOperationException.Reason.CONFLICT));
        assertThat(reads).hasValue(0);
        assertThat(attempts.findAllByFileIdOrderByCreatedAtAsc(expired.fileId())).isEmpty();
        assertThat(storage.putCount()).isZero();
    }

    @Test
    void claimRequiresVerifiedLiveFileAndReadRequiresClaim() throws Exception {
        FileScope scope = scope(90L, "note-a");
        var prepared = prepare(scope, VALID_WEBP, "chart.webp");
        FileReference reference = new FileReference(prepared.fileId(), scope);

        assertThatThrownBy(
                        () ->
                                owner.inTransaction(
                                        () -> files.claim(new ClaimFileCommand(reference))))
                .isInstanceOfSatisfying(
                        FileOperationException.class,
                        failure ->
                                assertThat(failure.reason())
                                        .isEqualTo(FileOperationException.Reason.CONFLICT));
        assertThatThrownBy(() -> files.openRead(new ReadFileQuery(reference)))
                .isInstanceOfSatisfying(
                        FileOperationException.class,
                        failure ->
                                assertThat(failure.reason())
                                        .isEqualTo(
                                                FileOperationException.Reason.CONTENT_UNAVAILABLE));
        assertThat(storage.getCount()).isZero();

        assertThat(transfer(prepared.fileId(), scope, VALID_WEBP).disposition())
                .isEqualTo(TransferDisposition.VERIFIED);
        storage.resetReadTracking();
        assertThatThrownBy(() -> files.claim(new ClaimFileCommand(reference)))
                .isInstanceOf(IllegalTransactionStateException.class);

        assertThat(owner.inTransaction(() -> files.claim(new ClaimFileCommand(reference))))
                .isEqualTo(com.krishnamurti.horizon.file.api.model.ClaimResult.CLAIMED);
        assertThat(owner.inTransaction(() -> files.claim(new ClaimFileCommand(reference))))
                .isEqualTo(com.krishnamurti.horizon.file.api.model.ClaimResult.ALREADY_CLAIMED);
        try (var content = files.openRead(new ReadFileQuery(reference))) {
            assertThat(content.metadata().validatedFormat())
                    .isEqualTo(com.krishnamurti.horizon.file.api.model.FileFormat.WEBP);
            assertThat(content.stream().readAllBytes()).containsExactly(VALID_WEBP);
        }
        assertThat(storage.getCount()).isEqualTo(1);
    }

    @Test
    void claimAndCleanupChangesRollBackWithTheCallerTransaction() {
        FileScope scope = scope(91L, "note-a");
        var prepared = prepare(scope, VALID_WEBP, "chart.webp");
        assertThat(transfer(prepared.fileId(), scope, VALID_WEBP).disposition())
                .isEqualTo(TransferDisposition.VERIFIED);
        FileReference reference = new FileReference(prepared.fileId(), scope);

        assertThatThrownBy(
                        () ->
                                owner.inTransaction(
                                        () -> {
                                            files.claim(new ClaimFileCommand(reference));
                                            throw new IllegalStateException("rollback claim");
                                        }))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("rollback claim");
        assertThat(
                        jdbc.queryForObject(
                                "select claimed_at is not null from file_metadata where id = ?",
                                Boolean.class,
                                prepared.fileId()))
                .isFalse();

        assertThatThrownBy(
                        () ->
                                owner.inTransaction(
                                        () -> {
                                            files.requestCleanup(new CleanupFileCommand(reference));
                                            throw new IllegalStateException("rollback cleanup");
                                        }))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("rollback cleanup");
        assertThat(
                        jdbc.queryForObject(
                                "select cleanup_requested_at is not null from file_metadata"
                                        + " where id = ?",
                                Boolean.class,
                                prepared.fileId()))
                .isFalse();
    }

    @Test
    void cleanupIntentIsIdempotentAndDisablesReadsWithoutDeletingObjects() {
        FileScope scope = scope(92L, "note-a");
        var prepared = prepare(scope, VALID_WEBP, "chart.webp");
        assertThat(transfer(prepared.fileId(), scope, VALID_WEBP).disposition())
                .isEqualTo(TransferDisposition.VERIFIED);
        storage.resetReadTracking();
        FileReference reference = new FileReference(prepared.fileId(), scope);
        assertThat(owner.inTransaction(() -> files.claim(new ClaimFileCommand(reference))))
                .isEqualTo(com.krishnamurti.horizon.file.api.model.ClaimResult.CLAIMED);
        FileTransferAttemptEntity selected =
                attempts.findAllByFileIdOrderByCreatedAtAsc(prepared.fileId()).getFirst();

        owner.inTransaction(
                () -> {
                    files.requestCleanup(new CleanupFileCommand(reference));
                    return null;
                });
        Timestamp firstCleanup =
                jdbc.queryForObject(
                        "select cleanup_requested_at from file_metadata where id = ?",
                        Timestamp.class,
                        prepared.fileId());
        owner.inTransaction(
                () -> {
                    files.requestCleanup(new CleanupFileCommand(reference));
                    return null;
                });

        Timestamp repeatedCleanup =
                jdbc.queryForObject(
                        "select cleanup_requested_at from file_metadata where id = ?",
                        Timestamp.class,
                        prepared.fileId());
        assertThat(repeatedCleanup.toInstant()).isEqualTo(firstCleanup.toInstant());
        assertThat(attempts.findById(selected.getId()).orElseThrow().getCleanupRequestedAt())
                .isNotNull();
        assertThatThrownBy(() -> files.openRead(new ReadFileQuery(reference)))
                .isInstanceOfSatisfying(
                        FileOperationException.class,
                        failure ->
                                assertThat(failure.reason())
                                        .isEqualTo(
                                                FileOperationException.Reason.CONTENT_UNAVAILABLE));
        assertThat(storage.getCount()).isZero();
        assertThat(
                        storage.head(
                                        new com.krishnamurti.horizon.file.application.port
                                                .ObjectKey(selected.getObjectKey()))
                                .found())
                .isTrue();
    }

    @Test
    void expiredFileCannotBeClaimedAndScopeMismatchCannotRead() {
        FileScope scope = scope(93L, "note-a");
        var prepared = prepare(scope, VALID_WEBP, "chart.webp");
        assertThat(transfer(prepared.fileId(), scope, VALID_WEBP).disposition())
                .isEqualTo(TransferDisposition.VERIFIED);
        storage.resetReadTracking();
        jdbc.update("update file_metadata set expires_at = now() where id = ?", prepared.fileId());
        FileReference reference = new FileReference(prepared.fileId(), scope);

        assertThatThrownBy(
                        () ->
                                owner.inTransaction(
                                        () -> files.claim(new ClaimFileCommand(reference))))
                .isInstanceOfSatisfying(
                        FileOperationException.class,
                        failure ->
                                assertThat(failure.reason())
                                        .isEqualTo(FileOperationException.Reason.CONFLICT));
        assertThatThrownBy(
                        () ->
                                files.openRead(
                                        new ReadFileQuery(
                                                new FileReference(
                                                        prepared.fileId(),
                                                        scope(93L, "different-note")))))
                .isInstanceOfSatisfying(
                        FileOperationException.class,
                        failure ->
                                assertThat(failure.reason())
                                        .isEqualTo(
                                                FileOperationException.Reason
                                                        .NOT_FOUND_OR_FORBIDDEN));
        assertThat(storage.getCount()).isZero();
    }

    private com.krishnamurti.horizon.file.api.model.FileSnapshot prepare(
            FileScope scope, byte[] bytes, String filename) {
        return owner.prepare(
                new com.krishnamurti.horizon.file.api.command.PrepareFileCommand(
                        UUID.randomUUID(), scope, descriptor(bytes, filename)));
    }

    private com.krishnamurti.horizon.file.api.model.TransferResult transfer(
            UUID fileId, FileScope scope, byte[] bytes) {
        return files.transfer(
                new TransferFileCommand(
                        new FileReference(fileId, scope),
                        bytes.length,
                        new ByteArrayInputStream(bytes)));
    }

    private static FileDescriptor descriptor(byte[] bytes, String filename) {
        return new FileDescriptor(filename, "image/webp", bytes.length, sha256(bytes));
    }

    private static FileScope scope(long user, String binding) {
        return FilePrepareIntegrationTest.scope(user, binding);
    }

    private static byte[] fixture(String path) {
        try (InputStream input =
                FileTransferIntegrationTest.class.getClassLoader().getResourceAsStream(path)) {
            if (input == null)
                throw new IllegalStateException("Missing validation fixture: " + path);
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
