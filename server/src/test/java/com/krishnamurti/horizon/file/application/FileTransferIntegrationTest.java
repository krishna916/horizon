package com.krishnamurti.horizon.file.application;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.krishnamurti.horizon.TestcontainersConfiguration;
import com.krishnamurti.horizon.file.api.FileOperationException;
import com.krishnamurti.horizon.file.api.FileService;
import com.krishnamurti.horizon.file.api.command.ClaimFileCommand;
import com.krishnamurti.horizon.file.api.command.CleanupFileCommand;
import com.krishnamurti.horizon.file.api.command.PrepareFileCommand;
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
import com.krishnamurti.horizon.file.infrastructure.FileMetrics;
import com.krishnamurti.horizon.file.infrastructure.FileProperties;
import com.krishnamurti.horizon.file.infrastructure.persistence.FileMetadataPersistence;
import com.krishnamurti.horizon.file.infrastructure.persistence.FileMetadataRepository;
import com.krishnamurti.horizon.file.infrastructure.persistence.FileTransferAttemptRepository;
import com.krishnamurti.horizon.file.infrastructure.staging.FileStagingService;
import com.krishnamurti.horizon.file.infrastructure.staging.StagingCapacity;
import com.krishnamurti.horizon.file.infrastructure.storage.s3.S3ObjectStorage;
import com.krishnamurti.horizon.file.infrastructure.validation.FileValidationService;
import com.sun.net.httpserver.HttpServer;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.URI;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.sql.Timestamp;
import java.util.HexFormat;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.IllegalTransactionStateException;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import software.amazon.awssdk.auth.credentials.AwsBasicCredentials;
import software.amazon.awssdk.auth.credentials.StaticCredentialsProvider;
import software.amazon.awssdk.core.retry.RetryPolicy;
import software.amazon.awssdk.http.apache.ApacheHttpClient;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.s3.S3Client;

@Import({TestcontainersConfiguration.class, FileApplicationTestConfiguration.class})
@SpringBootTest
class FileTransferIntegrationTest {
    private static final byte[] VALID_WEBP = fixture("file/fixtures/static.webp");
    @Autowired private FileService files;
    @Autowired private TestFileOwner owner;
    @Autowired private RecordingObjectStorage storage;
    @Autowired private FileMetadataPersistence metadataPersistence;
    @Autowired private FileMetadataRepository metadataRepository;
    @Autowired private FileTransactions transactions;
    @Autowired private RecoveryClock recoveryClock;
    @Autowired private FileStagingService staging;
    @Autowired private FileValidationService validation;
    @Autowired private FileMetrics metrics;
    @Autowired private StagingCapacity stagingCapacity;
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
    void nonstandardOfficeXmlRejectedBeforeAttemptRegistration() throws Exception {
        byte[] officeBytes = docxWithNonstandardXmlPart();
        FileScope scope = scope(82L, "nonstandard-office-xml");
        var prepared =
                owner.prepare(
                        new PrepareFileCommand(
                                UUID.randomUUID(),
                                scope,
                                new FileDescriptor(
                                        "report.docx",
                                        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                                        officeBytes.length,
                                        sha256(officeBytes))));

        assertThatThrownBy(
                        () ->
                                files.transfer(
                                        new TransferFileCommand(
                                                new FileReference(prepared.fileId(), scope),
                                                officeBytes.length,
                                                new ByteArrayInputStream(officeBytes))))
                .isInstanceOfSatisfying(
                        FileOperationException.class,
                        failure ->
                                assertThat(failure.reason())
                                        .isEqualTo(FileOperationException.Reason.INVALID_CONTENT));

        assertThat(storage.putCount()).isZero();
        assertThat(attempts.findAllByFileIdOrderByCreatedAtAsc(prepared.fileId())).isEmpty();
        assertThat(
                        metadataRepository
                                .findById(prepared.fileId())
                                .orElseThrow()
                                .getSelectedAttemptId())
                .isNull();
        assertThat(stagingCapacity.activeSlots()).isZero();
        assertThat(stagingCapacity.reservedBytes()).isZero();
        try (var stagedFiles =
                java.nio.file.Files.list(Path.of(properties.getStaging().getDirectory()))) {
            assertThat(
                            stagedFiles.filter(
                                    path ->
                                            path.getFileName()
                                                            .toString()
                                                            .startsWith("horizon-file-")
                                                    && path.getFileName()
                                                            .toString()
                                                            .endsWith(".stage")))
                    .isEmpty();
        }
    }

    @Test
    void shortLongOrDigestMismatchedUploadIsInvalidContentBeforeAttemptRegistration() {
        var digestMismatch = prepare(scope(82L, "digest-mismatch"), VALID_WEBP, "chart.webp");
        byte[] differentBytes = VALID_WEBP.clone();
        differentBytes[differentBytes.length - 1] ^= 1;
        assertThatThrownBy(
                        () ->
                                transfer(
                                        digestMismatch.fileId(),
                                        scope(82L, "digest-mismatch"),
                                        differentBytes))
                .isInstanceOfSatisfying(
                        FileOperationException.class,
                        failure ->
                                assertThat(failure.reason())
                                        .isEqualTo(FileOperationException.Reason.INVALID_CONTENT));

        var shortUpload = prepare(scope(82L, "short"), VALID_WEBP, "chart.webp");
        assertThatThrownBy(
                        () ->
                                files.transfer(
                                        new TransferFileCommand(
                                                new FileReference(
                                                        shortUpload.fileId(), scope(82L, "short")),
                                                VALID_WEBP.length,
                                                new ByteArrayInputStream(
                                                        java.util.Arrays.copyOf(
                                                                VALID_WEBP,
                                                                VALID_WEBP.length - 1)))))
                .isInstanceOfSatisfying(
                        FileOperationException.class,
                        failure ->
                                assertThat(failure.reason())
                                        .isEqualTo(FileOperationException.Reason.INVALID_CONTENT));

        var longUpload = prepare(scope(82L, "long"), VALID_WEBP, "chart.webp");
        byte[] longBytes = java.util.Arrays.copyOf(VALID_WEBP, VALID_WEBP.length + 1);
        assertThatThrownBy(
                        () ->
                                files.transfer(
                                        new TransferFileCommand(
                                                new FileReference(
                                                        longUpload.fileId(), scope(82L, "long")),
                                                VALID_WEBP.length,
                                                new ByteArrayInputStream(longBytes))))
                .isInstanceOfSatisfying(
                        FileOperationException.class,
                        failure ->
                                assertThat(failure.reason())
                                        .isEqualTo(FileOperationException.Reason.INVALID_CONTENT));

        var ioFailure = prepare(scope(82L, "io-failure"), VALID_WEBP, "chart.webp");
        assertThatThrownBy(
                        () ->
                                files.transfer(
                                        new TransferFileCommand(
                                                new FileReference(
                                                        ioFailure.fileId(),
                                                        scope(82L, "io-failure")),
                                                VALID_WEBP.length,
                                                new InputStream() {
                                                    @Override
                                                    public int read() throws IOException {
                                                        throw new IOException(
                                                                "simulated source I/O");
                                                    }

                                                    @Override
                                                    public int read(
                                                            byte[] bytes, int offset, int length)
                                                            throws IOException {
                                                        throw new IOException(
                                                                "simulated source I/O");
                                                    }
                                                })))
                .isInstanceOfSatisfying(
                        FileOperationException.class,
                        failure ->
                                assertThat(failure.reason())
                                        .isEqualTo(
                                                FileOperationException.Reason.STORAGE_UNAVAILABLE));

        assertThat(storage.putCount()).isZero();
        assertThat(attempts.findAllByFileIdOrderByCreatedAtAsc(digestMismatch.fileId())).isEmpty();
        assertThat(attempts.findAllByFileIdOrderByCreatedAtAsc(shortUpload.fileId())).isEmpty();
        assertThat(attempts.findAllByFileIdOrderByCreatedAtAsc(longUpload.fileId())).isEmpty();
        assertThat(attempts.findAllByFileIdOrderByCreatedAtAsc(ioFailure.fileId())).isEmpty();
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
    void getHeadersAndBodyShareOneVerificationBudget() {
        var prepared = prepare(scope(89L, "header-budget"), VALID_WEBP, "chart.webp");
        properties.getStorage().getS3().setOperationTimeout(java.time.Duration.ofMillis(180));
        AtomicBoolean aborted = new AtomicBoolean();
        AtomicInteger abortCount = new AtomicInteger();
        long started = System.nanoTime();
        storage.nextGetObject(
                () -> {
                    try {
                        Thread.sleep(140);
                    } catch (InterruptedException exception) {
                        Thread.currentThread().interrupt();
                        throw new IllegalStateException(exception);
                    }
                    return new StoredObject(
                            new InputStream() {
                                private int position;

                                @Override
                                public int read() throws IOException {
                                    byte[] one = new byte[1];
                                    int read = read(one, 0, 1);
                                    return read < 0 ? -1 : Byte.toUnsignedInt(one[0]);
                                }

                                @Override
                                public int read(byte[] bytes, int offset, int length)
                                        throws IOException {
                                    try {
                                        Thread.sleep(60);
                                    } catch (InterruptedException exception) {
                                        Thread.currentThread().interrupt();
                                        throw new IOException(exception);
                                    }
                                    if (aborted.get()) throw new IOException("aborted");
                                    if (position == VALID_WEBP.length) return -1;
                                    bytes[offset] = VALID_WEBP[position++];
                                    return 1;
                                }
                            },
                            VALID_WEBP.length,
                            "image/webp",
                            () -> {
                                abortCount.incrementAndGet();
                                aborted.set(true);
                            });
                });

        var result = transfer(prepared.fileId(), scope(89L, "header-budget"), VALID_WEBP);
        long elapsedMillis =
                java.util.concurrent.TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - started);

        assertThat(result.disposition()).isEqualTo(TransferDisposition.RETRYABLE_FAILURE);
        assertThat(abortCount).hasValue(1);
        assertThat(elapsedMillis).isLessThan(300);
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
    void headerBudgetExhaustionAbortsWithoutStartingAnotherBudget() {
        var prepared = prepare(scope(89L, "header-timeout"), VALID_WEBP, "chart.webp");
        properties.getStorage().getS3().setOperationTimeout(java.time.Duration.ofMillis(100));
        AtomicInteger aborts = new AtomicInteger();
        storage.nextGetObject(
                () -> {
                    try {
                        Thread.sleep(180);
                    } catch (InterruptedException exception) {
                        Thread.currentThread().interrupt();
                        throw new IllegalStateException(exception);
                    }
                    return new StoredObject(
                            new ByteArrayInputStream(VALID_WEBP),
                            VALID_WEBP.length,
                            "image/webp",
                            aborts::incrementAndGet);
                });

        var result = transfer(prepared.fileId(), scope(89L, "header-timeout"), VALID_WEBP);

        assertThat(result.disposition()).isEqualTo(TransferDisposition.RETRYABLE_FAILURE);
        assertThat(aborts).hasValue(1);
        assertThat(result.file().metadata().validatedFormat()).isNull();
    }

    @Test
    void fullyVerifiedResponseClosesNormallyAndItsCancelledDeadlineCannotAbortLater()
            throws InterruptedException {
        var prepared = prepare(scope(89L, "normal-close"), VALID_WEBP, "chart.webp");
        properties.getStorage().getS3().setOperationTimeout(java.time.Duration.ofMillis(500));
        AtomicInteger aborts = new AtomicInteger();
        AtomicInteger closes = new AtomicInteger();
        storage.nextGetObject(
                () ->
                        new StoredObject(
                                new ByteArrayInputStream(VALID_WEBP) {
                                    @Override
                                    public void close() throws IOException {
                                        closes.incrementAndGet();
                                        super.close();
                                    }
                                },
                                VALID_WEBP.length,
                                "image/webp",
                                aborts::incrementAndGet));

        var result = transfer(prepared.fileId(), scope(89L, "normal-close"), VALID_WEBP);
        Thread.sleep(550);

        assertThat(result.disposition()).isEqualTo(TransferDisposition.VERIFIED);
        assertThat(closes).hasValue(1);
        assertThat(aborts).hasValue(0);
    }

    @Test
    void concurrentVerificationDeadlinesReleaseBothStalledStreams() throws Exception {
        FileScope firstScope = scope(89L, "concurrent-deadline-a");
        FileScope secondScope = scope(89L, "concurrent-deadline-b");
        var first = prepare(firstScope, VALID_WEBP, "chart.webp");
        var second = prepare(secondScope, VALID_WEBP, "chart.webp");
        properties.getStorage().getS3().setOperationTimeout(java.time.Duration.ofMillis(200));
        var firstEntered = new java.util.concurrent.CountDownLatch(1);
        var secondEntered = new java.util.concurrent.CountDownLatch(1);
        var firstReleased = new java.util.concurrent.CountDownLatch(1);
        var secondReleased = new java.util.concurrent.CountDownLatch(1);
        AtomicInteger firstAborts = new AtomicInteger();
        AtomicInteger secondAborts = new AtomicInteger();
        storage.nextGetObject(
                () ->
                        new StoredObject(
                                blockingStream(firstEntered, firstReleased),
                                VALID_WEBP.length,
                                "image/webp",
                                () -> {
                                    firstAborts.incrementAndGet();
                                    firstReleased.countDown();
                                }));
        storage.nextGetObject(
                () ->
                        new StoredObject(
                                blockingStream(secondEntered, secondReleased),
                                VALID_WEBP.length,
                                "image/webp",
                                () -> {
                                    secondAborts.incrementAndGet();
                                    secondReleased.countDown();
                                }));

        try (var executor = java.util.concurrent.Executors.newFixedThreadPool(2)) {
            var firstResult =
                    executor.submit(() -> transfer(first.fileId(), firstScope, VALID_WEBP));
            var secondResult =
                    executor.submit(() -> transfer(second.fileId(), secondScope, VALID_WEBP));
            assertThat(firstEntered.await(3, java.util.concurrent.TimeUnit.SECONDS)).isTrue();
            assertThat(secondEntered.await(3, java.util.concurrent.TimeUnit.SECONDS)).isTrue();

            assertThat(firstResult.get(3, java.util.concurrent.TimeUnit.SECONDS).disposition())
                    .isEqualTo(TransferDisposition.RETRYABLE_FAILURE);
            assertThat(secondResult.get(3, java.util.concurrent.TimeUnit.SECONDS).disposition())
                    .isEqualTo(TransferDisposition.RETRYABLE_FAILURE);
        }

        assertThat(firstAborts).hasValue(1);
        assertThat(secondAborts).hasValue(1);
        assertThat(firstReleased.getCount()).isZero();
        assertThat(secondReleased.getCount()).isZero();
    }

    private static InputStream blockingStream(
            java.util.concurrent.CountDownLatch entered,
            java.util.concurrent.CountDownLatch released) {
        return new InputStream() {
            @Override
            public int read() throws IOException {
                awaitAbort();
                return -1;
            }

            @Override
            public int read(byte[] bytes, int offset, int length) throws IOException {
                awaitAbort();
                return -1;
            }

            private void awaitAbort() throws IOException {
                entered.countDown();
                try {
                    released.await();
                } catch (InterruptedException exception) {
                    Thread.currentThread().interrupt();
                    throw new IOException("read interrupted", exception);
                }
                throw new IOException("verification stream aborted");
            }
        };
    }

    @Test
    void declaredLengthMismatchAbortsWithoutReadingOrDrainingBody() {
        var prepared = prepare(scope(89L, "length-mismatch"), VALID_WEBP, "chart.webp");
        AtomicInteger reads = new AtomicInteger();
        AtomicInteger aborts = new AtomicInteger();
        storage.nextGetObject(
                () ->
                        new StoredObject(
                                new InputStream() {
                                    @Override
                                    public int read() {
                                        reads.incrementAndGet();
                                        return -1;
                                    }

                                    @Override
                                    public int read(byte[] bytes, int offset, int length) {
                                        reads.incrementAndGet();
                                        return -1;
                                    }
                                },
                                VALID_WEBP.length + 1L,
                                "image/webp",
                                aborts::incrementAndGet));

        var result = transfer(prepared.fileId(), scope(89L, "length-mismatch"), VALID_WEBP);

        assertThat(result.disposition()).isEqualTo(TransferDisposition.RETRYABLE_FAILURE);
        assertThat(reads).hasValue(0);
        assertThat(aborts).hasValue(1);
    }

    @Test
    void actualS3SdkGetHeadersAndBodyShareOneDeadline() throws Exception {
        var prepared = prepare(scope(89L, "real-http-deadline"), VALID_WEBP, "chart.webp");
        properties.getStorage().getS3().setOperationTimeout(java.time.Duration.ofMillis(1_500));
        Map<String, byte[]> objects = new ConcurrentHashMap<>();
        AtomicInteger puts = new AtomicInteger();
        AtomicInteger gets = new AtomicInteger();
        AtomicLong getStartedAt = new AtomicLong();
        java.util.concurrent.CountDownLatch clientDisconnect =
                new java.util.concurrent.CountDownLatch(1);
        HttpServer server =
                HttpServer.create(new InetSocketAddress(InetAddress.getLoopbackAddress(), 0), 0);
        var serverExecutor = java.util.concurrent.Executors.newCachedThreadPool();
        server.setExecutor(serverExecutor);
        server.createContext(
                "/",
                exchange -> {
                    String path = exchange.getRequestURI().getPath();
                    if ("PUT".equals(exchange.getRequestMethod())) {
                        puts.incrementAndGet();
                        objects.put(
                                path, decodeAwsChunked(exchange.getRequestBody().readAllBytes()));
                        exchange.sendResponseHeaders(200, -1);
                        exchange.close();
                        return;
                    }
                    if (!"GET".equals(exchange.getRequestMethod())) {
                        exchange.sendResponseHeaders(405, -1);
                        exchange.close();
                        return;
                    }
                    gets.incrementAndGet();
                    getStartedAt.set(System.nanoTime());
                    byte[] bytes = objects.get(path);
                    try {
                        Thread.sleep(900);
                        exchange.getResponseHeaders().add("Content-Type", "image/webp");
                        exchange.sendResponseHeaders(200, bytes.length);
                        OutputStream body = exchange.getResponseBody();
                        for (int offset = 0; offset < bytes.length; offset += 8) {
                            if (offset > 0) Thread.sleep(300);
                            body.write(bytes, offset, Math.min(8, bytes.length - offset));
                            body.flush();
                        }
                    } catch (IOException exception) {
                        clientDisconnect.countDown();
                    } catch (InterruptedException exception) {
                        Thread.currentThread().interrupt();
                    } finally {
                        exchange.close();
                    }
                });
        server.start();

        URI endpoint = URI.create("http://127.0.0.1:" + server.getAddress().getPort());
        var credentials =
                StaticCredentialsProvider.create(
                        AwsBasicCredentials.create("local-access", "local-secret"));
        S3Client writeClient = testS3Client(endpoint, credentials);
        S3Client readClient = testS3Client(endpoint, credentials);
        S3ObjectStorage networkStorage =
                new S3ObjectStorage(writeClient, readClient, "horizon-files");
        DefaultFileService networkFiles =
                new DefaultFileService(
                        metadataPersistence,
                        metadataRepository,
                        transactions,
                        properties,
                        staging,
                        validation,
                        networkStorage,
                        metrics,
                        recoveryClock);
        try {
            var result =
                    networkFiles.transfer(
                            new TransferFileCommand(
                                    new FileReference(
                                            prepared.fileId(), scope(89L, "real-http-deadline")),
                                    VALID_WEBP.length,
                                    new ByteArrayInputStream(VALID_WEBP)));
            long getElapsedMillis =
                    java.util.concurrent.TimeUnit.NANOSECONDS.toMillis(
                            System.nanoTime() - getStartedAt.get());

            assertThat(result.disposition()).isEqualTo(TransferDisposition.RETRYABLE_FAILURE);
            assertThat(puts).hasValue(1);
            assertThat(gets).hasValue(1);
            assertThat(getElapsedMillis).isBetween(1_300L, 2_200L);
            assertThat(clientDisconnect.await(3, java.util.concurrent.TimeUnit.SECONDS)).isTrue();
            assertThat(stagingCapacity.activeSlots()).isZero();
            assertThat(stagingCapacity.reservedBytes()).isZero();
            assertThat(attempts.findAllByFileIdOrderByCreatedAtAsc(prepared.fileId()))
                    .singleElement()
                    .satisfies(
                            attempt -> {
                                assertThat(attempt.getOutcome()).isEqualTo(TransferOutcome.FAILED);
                                assertThat(attempt.getWriteSettledAt()).isNotNull();
                                assertThat(attempt.getCleanupRequestedAt()).isNotNull();
                            });
        } finally {
            networkStorage.close();
            writeClient.close();
            readClient.close();
            server.stop(0);
            serverExecutor.shutdownNow();
        }
    }

    private static S3Client testS3Client(
            URI endpoint,
            software.amazon.awssdk.auth.credentials.AwsCredentialsProvider credentials) {
        return S3Client.builder()
                .endpointOverride(endpoint)
                .region(Region.US_EAST_1)
                .credentialsProvider(credentials)
                .serviceConfiguration(
                        software.amazon.awssdk.services.s3.S3Configuration.builder()
                                .pathStyleAccessEnabled(true)
                                .build())
                .httpClientBuilder(
                        ApacheHttpClient.builder()
                                .connectionTimeout(java.time.Duration.ofSeconds(2))
                                .socketTimeout(java.time.Duration.ofSeconds(5)))
                .overrideConfiguration(
                        configuration ->
                                configuration
                                        .apiCallTimeout(java.time.Duration.ofSeconds(8))
                                        .apiCallAttemptTimeout(java.time.Duration.ofSeconds(8))
                                        .retryPolicy(RetryPolicy.none()))
                .build();
    }

    private static byte[] decodeAwsChunked(byte[] encoded) throws IOException {
        java.io.ByteArrayOutputStream decoded = new java.io.ByteArrayOutputStream();
        int cursor = 0;
        while (cursor < encoded.length) {
            int lineEnd = cursor;
            while (lineEnd < encoded.length - 1
                    && (encoded[lineEnd] != '\r' || encoded[lineEnd + 1] != '\n')) {
                lineEnd++;
            }
            if (lineEnd == encoded.length - 1) throw new IOException("Malformed AWS chunk header");
            String header =
                    new String(
                            encoded,
                            cursor,
                            lineEnd - cursor,
                            java.nio.charset.StandardCharsets.US_ASCII);
            int length = Integer.parseInt(header.split(";", 2)[0], 16);
            cursor = lineEnd + 2;
            if (length == 0) break;
            decoded.write(encoded, cursor, length);
            cursor += length;
            if (encoded[cursor] != '\r' || encoded[cursor + 1] != '\n') {
                throw new IOException("Malformed AWS chunk framing");
            }
            cursor += 2;
        }
        return decoded.toByteArray();
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

    private static byte[] docxWithNonstandardXmlPart() throws IOException {
        Map<String, byte[]> entries =
                Map.of(
                        "[Content_Types].xml",
                        ("<?xml version=\"1.0\"?><Types"
                             + " xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\"><Default"
                             + " Extension=\"rels\""
                             + " ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/><Override"
                             + " PartName=\"/word/document.xml\""
                             + " ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml\"/><Override"
                             + " PartName=\"/custom/metadata.bin\""
                             + " ContentType=\"application/xml\"/></Types>")
                                .getBytes(java.nio.charset.StandardCharsets.UTF_8),
                        "_rels/.rels",
                        ("<?xml version=\"1.0\"?><Relationships"
                             + " xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"><Relationship"
                             + " Id=\"rId1\""
                             + " Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\""
                             + " Target=\"word/document.xml\"/></Relationships>")
                                .getBytes(java.nio.charset.StandardCharsets.UTF_8),
                        "word/document.xml",
                        ("<?xml version=\"1.0\"?><w:document"
                             + " xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\"/>")
                                .getBytes(java.nio.charset.StandardCharsets.UTF_8),
                        "custom/metadata.bin",
                        "<!DOCTYPE x [<!ENTITY e \"blocked\">]><x>&e;</x>"
                                .getBytes(java.nio.charset.StandardCharsets.UTF_8));
        try (ByteArrayOutputStream bytes = new ByteArrayOutputStream();
                ZipOutputStream zip = new ZipOutputStream(bytes)) {
            for (Map.Entry<String, byte[]> entry : entries.entrySet()) {
                zip.putNextEntry(new ZipEntry(entry.getKey()));
                zip.write(entry.getValue());
                zip.closeEntry();
            }
            zip.finish();
            return bytes.toByteArray();
        }
    }
}
