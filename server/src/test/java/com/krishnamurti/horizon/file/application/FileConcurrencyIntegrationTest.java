package com.krishnamurti.horizon.file.application;

import static org.assertj.core.api.Assertions.assertThat;

import com.krishnamurti.horizon.TestcontainersConfiguration;
import com.krishnamurti.horizon.file.api.FileService;
import com.krishnamurti.horizon.file.api.command.CleanupFileCommand;
import com.krishnamurti.horizon.file.api.command.PrepareFileCommand;
import com.krishnamurti.horizon.file.api.command.TransferFileCommand;
import com.krishnamurti.horizon.file.api.model.FileDescriptor;
import com.krishnamurti.horizon.file.api.model.FileLifecycle;
import com.krishnamurti.horizon.file.api.model.FileReference;
import com.krishnamurti.horizon.file.api.model.FileScope;
import com.krishnamurti.horizon.file.api.model.TransferDisposition;
import com.krishnamurti.horizon.file.api.query.ReadFileQuery;
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
import java.util.List;
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

@Import({TestcontainersConfiguration.class, FileApplicationTestConfiguration.class})
@SpringBootTest
class FileConcurrencyIntegrationTest {
    private static final byte[] VALID_WEBP = fixture("file/fixtures/static.webp");

    @Autowired private FileService files;
    @Autowired private TestFileOwner owner;
    @Autowired private RecordingObjectStorage storage;
    @Autowired private FileTransferAttemptRepository attempts;
    @Autowired private JdbcTemplate jdbc;
    @Autowired private FileProperties properties;

    @BeforeEach
    void resetFixture() {
        FilePrepareIntegrationTest.ensureUsers(jdbc);
        jdbc.update("update file_metadata set claimed_at = null, selected_attempt_id = null");
        jdbc.update("delete from file_transfer_attempt");
        jdbc.update("delete from file_metadata");
        storage.reset();
        properties.setMaxFileSize(org.springframework.util.unit.DataSize.ofBytes(20_971_519L));
    }

    @Test
    void twoConcurrentTransfersSelectExactlyOneAndRetainLoser() throws Exception {
        FileReference reference = preparedFile(scope(76L, "parallel-transfer"));
        CountDownLatch putsEntered = new CountDownLatch(2);
        CountDownLatch releasePuts = new CountDownLatch(1);
        storage.putHook(
                request -> {
                    putsEntered.countDown();
                    await(releasePuts);
                });

        try (var executor = Executors.newFixedThreadPool(2)) {
            var first = executor.submit(() -> transfer(reference));
            var second = executor.submit(() -> transfer(reference));
            assertThat(putsEntered.await(20, TimeUnit.SECONDS)).isTrue();
            releasePuts.countDown();

            var results =
                    List.of(first.get(30, TimeUnit.SECONDS), second.get(30, TimeUnit.SECONDS));
            assertThat(results)
                    .extracting(result -> result.disposition())
                    .containsExactlyInAnyOrder(
                            TransferDisposition.VERIFIED, TransferDisposition.RETRYABLE_FAILURE);
        } finally {
            releasePuts.countDown();
        }

        List<FileTransferAttemptEntity> rows =
                attempts.findAllByFileIdOrderByCreatedAtAsc(reference.fileId());
        assertThat(rows).hasSize(2);
        UUID selected = selectedAttempt(reference.fileId());
        assertThat(selected).isNotNull();
        assertThat(rows.stream().filter(row -> row.getId().equals(selected)))
                .singleElement()
                .satisfies(row -> assertThat(row.getOutcome()).isEqualTo(TransferOutcome.VERIFIED));
        assertThat(rows.stream().filter(row -> !row.getId().equals(selected)))
                .singleElement()
                .satisfies(
                        row -> {
                            assertThat(row.getOutcome()).isEqualTo(TransferOutcome.VERIFIED);
                            assertThat(row.getCleanupRequestedAt()).isNotNull();
                            assertThat(row.getWriteSettledAt()).isNotNull();
                        });
        assertThat(rows.stream().map(FileTransferAttemptEntity::getObjectKey).distinct())
                .hasSize(2);
        assertThat(storage.putCount()).isEqualTo(2);
    }

    @Test
    void lateCompletionAfterCleanupNeverPromotesAndRetainsObjectLocator() throws Exception {
        FileReference reference = preparedFile(scope(77L, "late-cleanup"));
        CountDownLatch putEntered = new CountDownLatch(1);
        CountDownLatch releasePut = new CountDownLatch(1);
        storage.putHook(
                request -> {
                    putEntered.countDown();
                    await(releasePut);
                });

        var result = executeLateTransfer(reference, putEntered, releasePut, true);

        assertThat(result.disposition()).isEqualTo(TransferDisposition.RETRYABLE_FAILURE);
        assertThat(selectedAttempt(reference.fileId())).isNull();
        assertThat(
                        files.inspect(
                                        new com.krishnamurti.horizon.file.api.query
                                                .InspectFileQuery(reference))
                                .lifecycle())
                .isEqualTo(FileLifecycle.CLEANUP_REQUESTED);
        FileTransferAttemptEntity late =
                attempts.findAllByFileIdOrderByCreatedAtAsc(reference.fileId()).getFirst();
        assertThat(late.getOutcome()).isEqualTo(TransferOutcome.VERIFIED);
        assertThat(late.getCleanupRequestedAt()).isNotNull();
        assertThat(
                        storage.head(
                                        new com.krishnamurti.horizon.file.application.port
                                                .ObjectKey(late.getObjectKey()))
                                .found())
                .isTrue();
        assertThat(storage.getCount()).isEqualTo(1);
        assertThatThrownByRead(reference);
    }

    @Test
    void lateCompletionAfterExpiryNeverPromotesAndRetainsObjectLocator() throws Exception {
        FileReference reference = preparedFile(scope(78L, "late-expiry"));
        CountDownLatch putEntered = new CountDownLatch(1);
        CountDownLatch releasePut = new CountDownLatch(1);
        storage.putHook(
                request -> {
                    putEntered.countDown();
                    await(releasePut);
                });

        var result = executeLateTransfer(reference, putEntered, releasePut, false);

        assertThat(result.disposition()).isEqualTo(TransferDisposition.RETRYABLE_FAILURE);
        assertThat(selectedAttempt(reference.fileId())).isNull();
        assertThat(
                        files.inspect(
                                        new com.krishnamurti.horizon.file.api.query
                                                .InspectFileQuery(reference))
                                .lifecycle())
                .isEqualTo(FileLifecycle.EXPIRED);
        FileTransferAttemptEntity late =
                attempts.findAllByFileIdOrderByCreatedAtAsc(reference.fileId()).getFirst();
        assertThat(late.getOutcome()).isEqualTo(TransferOutcome.VERIFIED);
        assertThat(late.getCleanupRequestedAt()).isNotNull();
        assertThat(
                        storage.head(
                                        new com.krishnamurti.horizon.file.application.port
                                                .ObjectKey(late.getObjectKey()))
                                .found())
                .isTrue();
        assertThat(storage.getCount()).isEqualTo(1);
        assertThatThrownByRead(reference);
    }

    private com.krishnamurti.horizon.file.api.model.TransferResult executeLateTransfer(
            FileReference reference,
            CountDownLatch putEntered,
            CountDownLatch releasePut,
            boolean cleanup)
            throws Exception {
        try (var executor = Executors.newSingleThreadExecutor()) {
            var result = executor.submit(() -> transfer(reference));
            assertThat(putEntered.await(20, TimeUnit.SECONDS)).isTrue();
            if (cleanup) {
                owner.inTransaction(
                        () -> {
                            files.requestCleanup(new CleanupFileCommand(reference));
                            return null;
                        });
            } else {
                jdbc.update(
                        "update file_metadata set expires_at = now() where id = ?",
                        reference.fileId());
            }
            releasePut.countDown();
            return result.get(30, TimeUnit.SECONDS);
        } finally {
            releasePut.countDown();
        }
    }

    private void assertThatThrownByRead(FileReference reference) {
        org.assertj.core.api.Assertions.assertThatThrownBy(
                        () -> files.openRead(new ReadFileQuery(reference)))
                .isInstanceOf(IllegalStateException.class);
    }

    private void await(CountDownLatch latch) {
        try {
            if (!latch.await(20, TimeUnit.SECONDS)) {
                throw new IllegalStateException("Transfer gate timed out");
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("Transfer gate interrupted", e);
        }
    }

    private com.krishnamurti.horizon.file.api.model.TransferResult transfer(
            FileReference reference) {
        return files.transfer(
                new TransferFileCommand(
                        reference, VALID_WEBP.length, new ByteArrayInputStream(VALID_WEBP)));
    }

    private UUID selectedAttempt(UUID fileId) {
        return jdbc.queryForObject(
                "select selected_attempt_id from file_metadata where id = ?", UUID.class, fileId);
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
                FileConcurrencyIntegrationTest.class.getClassLoader().getResourceAsStream(path)) {
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
