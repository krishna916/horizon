package com.krishnamurti.horizon.file.application;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
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
import com.krishnamurti.horizon.file.api.model.FileSnapshot;
import com.krishnamurti.horizon.file.api.model.TransferDisposition;
import com.krishnamurti.horizon.file.api.query.ReadFileQuery;
import com.krishnamurti.horizon.file.application.port.DeleteResult;
import com.krishnamurti.horizon.file.application.port.ObjectKey;
import com.krishnamurti.horizon.file.application.port.ObjectMetadata;
import com.krishnamurti.horizon.file.application.port.ObjectStorage;
import com.krishnamurti.horizon.file.application.port.ObjectWriteRequest;
import com.krishnamurti.horizon.file.application.port.StoredObject;
import com.krishnamurti.horizon.file.application.port.WriteResult;
import com.krishnamurti.horizon.file.domain.TransferOutcome;
import com.krishnamurti.horizon.file.infrastructure.FileMetrics;
import com.krishnamurti.horizon.file.infrastructure.FileProperties;
import com.krishnamurti.horizon.file.infrastructure.FileRecoveryMetrics;
import com.krishnamurti.horizon.file.infrastructure.FileStorageHealthIndicator;
import com.krishnamurti.horizon.file.infrastructure.persistence.FileMetadataPersistence;
import com.krishnamurti.horizon.file.infrastructure.persistence.FileMetadataRepository;
import com.krishnamurti.horizon.file.infrastructure.persistence.FileRecoveryPersistence;
import com.krishnamurti.horizon.file.infrastructure.persistence.FileTransferAttemptRepository;
import com.krishnamurti.horizon.file.infrastructure.staging.FileStagingService;
import com.krishnamurti.horizon.file.infrastructure.storage.S3FaultHarness;
import com.krishnamurti.horizon.file.infrastructure.storage.SeaweedFsTestConfiguration;
import com.krishnamurti.horizon.file.infrastructure.storage.s3.RealProviderFixture;
import com.krishnamurti.horizon.file.infrastructure.storage.s3.S3ObjectStorage;
import com.krishnamurti.horizon.file.infrastructure.validation.FileValidationService;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import javax.imageio.ImageIO;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.RepeatedTest;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.health.contributor.Status;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.testcontainers.containers.GenericContainer;
import software.amazon.awssdk.services.s3.model.ListObjectsV2Response;

@Import({TestcontainersConfiguration.class, FileApplicationTestConfiguration.class})
@SpringBootTest
class FileRealProviderIntegrationTest {
    private static final byte[] WEBP = fixture("file/fixtures/static.webp");
    private static final String ACCESS_KEY = SeaweedFsTestConfiguration.ACCESS_KEY;
    private static final String SECRET_KEY = SeaweedFsTestConfiguration.SECRET_KEY;
    private static final String BUCKET = SeaweedFsTestConfiguration.BUCKET;

    @Autowired private FileService files;
    @Autowired private TestFileOwner owner;
    @Autowired private FileProperties fileProperties;
    @Autowired private FileMetadataPersistence metadataPersistence;
    @Autowired private FileMetadataRepository metadataRepository;
    @Autowired private FileTransactions transactions;
    @Autowired private FileRecoveryTransactions recoveryTransactions;
    @Autowired private FileRecoveryPersistence recoveryPersistence;
    @Autowired private RecoveryClock recoveryClock;
    @Autowired private FileRecoveryMetrics recoveryMetrics;
    @Autowired private FileStagingService staging;
    @Autowired private FileValidationService validation;
    @Autowired private FileMetrics metrics;
    @Autowired private FileTransferAttemptRepository attempts;
    @Autowired private JdbcTemplate jdbc;

    @BeforeEach
    void resetDatabase() {
        FilePrepareIntegrationTest.ensureUsers(jdbc);
        dropFailureObjects();
        jdbc.update("update file_metadata set selected_attempt_id = null, claimed_at = null");
        jdbc.update("delete from file_transfer_attempt");
        jdbc.update("delete from file_metadata");
    }

    @Test
    void productionServiceUsesPrivateSeaweedFsAndRetainsDbProviderStateAcrossRestart()
            throws Exception {
        Path data = Files.createTempDirectory("horizon-real-file-service-");
        Path volume = Files.createDirectories(data.resolve("storage"));
        GenericContainer<?> first = SeaweedFsTestConfiguration.container(volume);
        UUID completedFile;
        UUID pendingFile;
        FileScope completedScope = scope(96L, "real-round-trip");
        try {
            first.start();
            RealProviderFixture firstStorage = storage(endpoint(first));
            S3ObjectStorage storage = firstStorage.storage();
            try {
                DefaultFileService realFiles = realService(storage);
                var prepared = prepare(completedScope, "chart.webp");
                completedFile = prepared.fileId();
                var result =
                        realFiles.transfer(
                                new TransferFileCommand(
                                        new FileReference(completedFile, completedScope),
                                        WEBP.length,
                                        new java.io.ByteArrayInputStream(WEBP)));
                assertThat(result.disposition()).isEqualTo(TransferDisposition.VERIFIED);
                var attempt = attempts.findAllByFileIdOrderByCreatedAtAsc(completedFile).getFirst();
                assertThat(attempt.getOutcome()).isEqualTo(TransferOutcome.VERIFIED);
                assertThat(attempt.getWriteSettledAt()).isNotNull();
                assertThat(attempt.getVerifiedSha256()).isEqualTo(sha256(WEBP));
                assertThat(storage.head(new ObjectKey(attempt.getObjectKey())).found()).isTrue();
                assertThat(unsignedGet(endpoint(first), attempt.getObjectKey()).statusCode())
                        .isEqualTo(403);
                try (StoredObject object = storage.get(new ObjectKey(attempt.getObjectKey()));
                        ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                    object.content().transferTo(output);
                    assertThat(output.toByteArray()).containsExactly(WEBP);
                }

                FileReference reference = new FileReference(completedFile, completedScope);
                owner.inTransaction(() -> files.claim(new ClaimFileCommand(reference)));
                try (var content = realFiles.openRead(new ReadFileQuery(reference));
                        ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                    content.stream().transferTo(output);
                    assertThat(output.toByteArray()).containsExactly(WEBP);
                }

                verifyDatabaseFailureBeforePut(realFiles, endpoint(first));
                pendingFile = verifyDatabaseFailureAfterPut(realFiles, storage);
            } finally {
                firstStorage.close();
            }
            first.stop();

            try (GenericContainer<?> restarted = SeaweedFsTestConfiguration.container(volume)) {
                restarted.start();
                RealProviderFixture restartedStorage = storage(endpoint(restarted));
                S3ObjectStorage storageAfterRestart = restartedStorage.storage();
                try {
                    DefaultFileService serviceAfterRestart = realService(storageAfterRestart);
                    ListObjectsV2Response objects = listObjects(endpoint(restarted));
                    assertThat(objects.contents()).isNotEmpty();
                    var pending = attempts.findAllByFileIdOrderByCreatedAtAsc(pendingFile);
                    assertThat(pending)
                            .singleElement()
                            .satisfies(
                                    attempt -> {
                                        assertThat(attempt.getOutcome())
                                                .isEqualTo(TransferOutcome.PENDING);
                                        assertThat(attempt.getObjectKey()).isNotBlank();
                                    });
                    FileReference reference = new FileReference(completedFile, completedScope);
                    try (var content = serviceAfterRestart.openRead(new ReadFileQuery(reference));
                            ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                        content.stream().transferTo(output);
                        assertThat(output.toByteArray()).containsExactly(WEBP);
                    }
                    var completedAttempt =
                            attempts.findAllByFileIdOrderByCreatedAtAsc(completedFile).getFirst();
                    assertThat(
                                    storageAfterRestart.delete(
                                            new ObjectKey(completedAttempt.getObjectKey())))
                            .isNotNull();
                    assertThat(
                                    unsignedGet(
                                                    endpoint(restarted),
                                                    completedAttempt.getObjectKey())
                                            .statusCode())
                            .isNotEqualTo(200);
                    assertThatThrownBy(
                                    () ->
                                            serviceAfterRestart.openRead(
                                                    new ReadFileQuery(reference)))
                            .isInstanceOfSatisfying(
                                    FileOperationException.class,
                                    failure ->
                                            assertThat(failure.reason())
                                                    .isEqualTo(
                                                            FileOperationException.Reason
                                                                    .CONTENT_UNAVAILABLE));
                } finally {
                    restartedStorage.close();
                }
            }
        } finally {
            makeContainerDataRemovable(first);
            if (first.isRunning()) first.stop();
            makeRemovable(data);
            deleteTree(data);
        }
    }

    @Test
    void successfulProviderPutWithLostAcknowledgementRemainsUnknownAndUnselected()
            throws Exception {
        Path data = Files.createTempDirectory("horizon-real-lost-ack-");
        Path volume = Files.createDirectories(data.resolve("storage"));
        GenericContainer<?> seaweed = SeaweedFsTestConfiguration.container(volume);
        try {
            seaweed.start();
            URI providerEndpoint = endpoint(seaweed);
            try (RealProviderFixture provider = storage(providerEndpoint);
                    S3FaultHarness gate =
                            new S3FaultHarness(
                                    providerEndpoint,
                                    S3FaultHarness.Mode.DROP_SUCCESSFUL_PUT_RESPONSE)) {
                try (RealProviderFixture gated = storage(gate.endpoint())) {
                    FileScope scope = scope(99L, "real-lost-ack");
                    var prepared = prepare(scope, "lost-ack.webp");
                    var result =
                            realService(gated.storage())
                                    .transfer(transferCommand(prepared.fileId(), scope));
                    gate.awaitCompletion(java.time.Duration.ofSeconds(3));

                    assertThat(result.disposition()).isEqualTo(TransferDisposition.OUTCOME_UNKNOWN);
                    assertThat(gate.putRequests()).isEqualTo(1);
                    var attempt =
                            attempts.findAllByFileIdOrderByCreatedAtAsc(prepared.fileId())
                                    .getFirst();
                    assertThat(attempt.getOutcome()).isEqualTo(TransferOutcome.UNKNOWN);
                    assertThat(attempt.getObjectKey()).isNotBlank();
                    assertThat(attempt.getWriteSettledAt()).isNull();
                    assertThat(selectedAttempt(prepared.fileId())).isNull();
                    assertThat(
                                    provider.storage()
                                            .head(new ObjectKey(attempt.getObjectKey()))
                                            .found())
                            .isTrue();
                    try (StoredObject object =
                                    provider.storage().get(new ObjectKey(attempt.getObjectKey()));
                            ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                        object.content().transferTo(output);
                        assertThat(output.toByteArray()).containsExactly(WEBP);
                    }
                    owner.inTransaction(
                            () -> {
                                files.requestCleanup(
                                        new CleanupFileCommand(
                                                new FileReference(prepared.fileId(), scope)));
                                return null;
                            });
                    recoveryWorker(provider.storage()).runCycle();
                    var afterDelete =
                            attempts.findAllByFileIdOrderByCreatedAtAsc(prepared.fileId())
                                    .getFirst();
                    assertThat(
                                    provider.storage()
                                            .head(new ObjectKey(attempt.getObjectKey()))
                                            .found())
                            .isFalse();
                    assertThat(afterDelete.getOutcome()).isEqualTo(TransferOutcome.UNKNOWN);
                    assertThat(afterDelete.getObjectKey()).isEqualTo(attempt.getObjectKey());
                    assertThat(afterDelete.getCleanupConfirmedAt()).isNull();
                }
            }
        } finally {
            makeContainerDataRemovable(seaweed);
            if (seaweed.isRunning()) seaweed.stop();
            makeRemovable(data);
            deleteTree(data);
        }
    }

    @Test
    void heldPutCanBeCommittedByProviderThenItsSuccessfulResponseLost() throws Exception {
        Path data = Files.createTempDirectory("horizon-real-held-lost-ack-");
        Path volume = Files.createDirectories(data.resolve("storage"));
        GenericContainer<?> seaweed = SeaweedFsTestConfiguration.container(volume);
        try {
            seaweed.start();
            URI providerEndpoint = endpoint(seaweed);
            try (RealProviderFixture provider = storage(providerEndpoint);
                    S3FaultHarness gate =
                            new S3FaultHarness(
                                    providerEndpoint,
                                    S3FaultHarness.Mode.HOLD_PUT_DROP_SUCCESSFUL_RESPONSE);
                    RealProviderFixture gated = storage(gate.endpoint())) {
                gated.storage().checkAvailability();
                assertThat(gate.requests()).isPositive();
                assertThat(gate.putRequests()).isZero();
                assertThatThrownBy(() -> gate.awaitBufferedPut(java.time.Duration.ofMillis(100)))
                        .isInstanceOf(AssertionError.class);
                assertThatThrownBy(() -> gate.awaitCompletion(java.time.Duration.ofMillis(100)))
                        .isInstanceOf(AssertionError.class);

                FileScope scope = scope(99L, "held-lost-ack");
                var prepared = prepare(scope, "held-lost-ack.webp");
                var executor = Executors.newSingleThreadExecutor();
                try {
                    var transfer =
                            executor.submit(
                                    () ->
                                            realService(gated.storage())
                                                    .transfer(
                                                            transferCommand(
                                                                    prepared.fileId(), scope)));
                    gate.awaitBufferedPut(java.time.Duration.ofSeconds(5));
                    assertThat(gate.putRequests()).isEqualTo(1);
                    assertThat(provider.listObjects().contents()).isEmpty();

                    gate.releasePut();
                    gate.awaitCompletion(java.time.Duration.ofSeconds(8));
                    var result = transfer.get(8, TimeUnit.SECONDS);

                    assertThat(gate.successfulPutResponseObserved()).isTrue();
                    assertThat(result.disposition()).isEqualTo(TransferDisposition.OUTCOME_UNKNOWN);
                    var attempt =
                            attempts.findAllByFileIdOrderByCreatedAtAsc(prepared.fileId())
                                    .getFirst();
                    try (StoredObject object =
                                    provider.storage().get(new ObjectKey(attempt.getObjectKey()));
                            ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                        object.content().transferTo(output);
                        assertThat(output.toByteArray()).containsExactly(WEBP);
                    }
                } finally {
                    gate.releasePut();
                    executor.shutdownNow();
                }
            }
        } finally {
            makeContainerDataRemovable(seaweed);
            if (seaweed.isRunning()) seaweed.stop();
            makeRemovable(data);
            deleteTree(data);
        }
    }

    @Test
    void interruptedPutForwardsPrefixBeforeAbortingUpstream() throws Exception {
        Path data = Files.createTempDirectory("horizon-real-partial-put-");
        Path volume = Files.createDirectories(data.resolve("storage"));
        GenericContainer<?> seaweed = SeaweedFsTestConfiguration.container(volume);
        Path staged = Files.createTempFile(data, "partial-put-", ".png");
        try {
            byte[] png = largePng();
            Files.write(staged, png);
            seaweed.start();
            URI providerEndpoint = endpoint(seaweed);
            try (RealProviderFixture provider = storage(providerEndpoint);
                    S3FaultHarness gate =
                            new S3FaultHarness(
                                    providerEndpoint, S3FaultHarness.Mode.HOLD_PARTIAL_PUT);
                    RealProviderFixture gated = storage(gate.endpoint())) {
                var executor = Executors.newSingleThreadExecutor();
                ObjectKey key = new ObjectKey("fault-harness/partial-put.png");
                try {
                    var put =
                            executor.submit(
                                    () ->
                                            gated.storage()
                                                    .put(
                                                            new ObjectWriteRequest(
                                                                    key,
                                                                    staged,
                                                                    png.length,
                                                                    "image/png")));
                    gate.awaitForwardedBody(java.time.Duration.ofSeconds(8));
                    assertThat(gate.putRequests()).isEqualTo(1);
                    assertThat(gate.forwardedBodyBytes()).isPositive();
                    assertThat(gate.forwardedBodyBytes()).isLessThan(png.length);

                    gate.abortUpstream();
                    assertThat(put.get(8, TimeUnit.SECONDS)).isEqualTo(WriteResult.UNKNOWN);
                    assertThat(provider.storage().head(key).found()).isFalse();
                } finally {
                    gate.releasePut();
                    executor.shutdownNow();
                }
            }
        } finally {
            makeContainerDataRemovable(seaweed);
            if (seaweed.isRunning()) seaweed.stop();
            Files.deleteIfExists(staged);
            makeRemovable(data);
            deleteTree(data);
        }
    }

    private static byte[] largePng() throws Exception {
        BufferedImage image = new BufferedImage(512, 512, BufferedImage.TYPE_INT_RGB);
        for (int y = 0; y < image.getHeight(); y++) {
            for (int x = 0; x < image.getWidth(); x++) {
                int red = (x * 37 + y * 17) & 0xff;
                int green = (x * 11 + y * 53) & 0xff;
                int blue = (x * 97 + y * 7) & 0xff;
                image.setRGB(x, y, (red << 16) | (green << 8) | blue);
            }
        }
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        ImageIO.write(image, "png", output);
        return output.toByteArray();
    }

    @Test
    void realProviderOutageMarksStorageReadinessDownWithoutWriting() throws Exception {
        Path data = Files.createTempDirectory("horizon-real-provider-outage-");
        GenericContainer<?> seaweed =
                SeaweedFsTestConfiguration.container(
                        Files.createDirectories(data.resolve("storage")));
        try {
            seaweed.start();
            try (RealProviderFixture provider = storage(endpoint(seaweed))) {
                assertThatCode(provider.storage()::checkAvailability).doesNotThrowAnyException();
                FileStorageHealthIndicator health =
                        new FileStorageHealthIndicator(provider.storage(), metrics);
                assertThat(health.health().getStatus()).isEqualTo(Status.UP);
                assertThat(provider.listObjects().contents()).isEmpty();

                makeContainerDataRemovable(seaweed);
                seaweed.stop();

                assertThat(health.health().getStatus()).isEqualTo(Status.DOWN);
            }
        } finally {
            makeContainerDataRemovable(seaweed);
            if (seaweed.isRunning()) seaweed.stop();
            makeRemovable(data);
            deleteTree(data);
        }
    }

    @RepeatedTest(3)
    void lateProviderPutAfterCleanupIsDiscoverableAndRetryUsesDistinctKeys() throws Exception {
        Path data = Files.createTempDirectory("horizon-real-late-put-");
        Path volume = Files.createDirectories(data.resolve("storage"));
        GenericContainer<?> seaweed = SeaweedFsTestConfiguration.container(volume);
        try {
            seaweed.start();
            URI providerEndpoint = endpoint(seaweed);
            try (RealProviderFixture provider = storage(providerEndpoint);
                    S3FaultHarness gate =
                            new S3FaultHarness(providerEndpoint, S3FaultHarness.Mode.HOLD_PUT);
                    RealProviderFixture gated = storage(gate.endpoint())) {
                DefaultFileService realFiles = realService(gated.storage());
                FileScope lateScope = scope(99L, "real-late-put");
                var latePrepared = prepare(lateScope, "late-put.webp");
                var executor = Executors.newSingleThreadExecutor();
                try {
                    var transfer =
                            executor.submit(
                                    () ->
                                            realFiles.transfer(
                                                    transferCommand(
                                                            latePrepared.fileId(), lateScope)));
                    gate.awaitBufferedPut(java.time.Duration.ofSeconds(5));
                    var pendingAttempt =
                            attempts.findAllByFileIdOrderByCreatedAtAsc(latePrepared.fileId())
                                    .getFirst();
                    assertThat(pendingAttempt.getOutcome()).isEqualTo(TransferOutcome.PENDING);
                    assertThat(
                                    provider.storage()
                                            .head(new ObjectKey(pendingAttempt.getObjectKey()))
                                            .found())
                            .isFalse();
                    owner.inTransaction(
                            () -> {
                                files.requestCleanup(
                                        new CleanupFileCommand(
                                                new FileReference(
                                                        latePrepared.fileId(), lateScope)));
                                return null;
                            });
                    assertThat(
                                    jdbc.queryForObject(
                                            "select cleanup_requested_at is not null from"
                                                    + " file_metadata where id=?",
                                            Boolean.class,
                                            latePrepared.fileId()))
                            .isTrue();
                    recoveryWorker(provider.storage()).runCycle();
                    assertThat(
                                    provider.storage()
                                            .head(new ObjectKey(pendingAttempt.getObjectKey()))
                                            .found())
                            .isFalse();
                    var unknownAttempt =
                            attempts.findAllByFileIdOrderByCreatedAtAsc(latePrepared.fileId())
                                    .getFirst();
                    assertThat(unknownAttempt.getOutcome()).isEqualTo(TransferOutcome.UNKNOWN);
                    assertThat(unknownAttempt.getCleanupConfirmedAt()).isNull();
                    assertThat(unknownAttempt.getObjectKey())
                            .isEqualTo(pendingAttempt.getObjectKey());

                    gate.releasePut();
                    gate.awaitCompletion(java.time.Duration.ofSeconds(8));
                    var transferResult = transfer.get(8, TimeUnit.SECONDS);
                    assertThat(transferResult.disposition())
                            .isEqualTo(TransferDisposition.RETRYABLE_FAILURE);
                    var settledAttempt =
                            attempts.findAllByFileIdOrderByCreatedAtAsc(latePrepared.fileId())
                                    .getFirst();
                    assertThat(settledAttempt.getOutcome()).isEqualTo(TransferOutcome.VERIFIED);
                    assertThat(settledAttempt.getCleanupRequestedAt()).isNotNull();
                    assertThat(settledAttempt.getCleanupConfirmedAt()).isNull();
                    assertThat(settledAttempt.getObjectKey())
                            .isEqualTo(pendingAttempt.getObjectKey());
                    assertThat(selectedAttempt(latePrepared.fileId())).isNull();
                    assertThat(
                                    provider.storage()
                                            .head(new ObjectKey(settledAttempt.getObjectKey()))
                                            .found())
                            .isTrue();
                    try (StoredObject object =
                                    provider.storage()
                                            .get(new ObjectKey(settledAttempt.getObjectKey()));
                            ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                        object.content().transferTo(output);
                        assertThat(output.toByteArray()).containsExactly(WEBP);
                    }
                    recoveryWorker(provider.storage()).runCycle();
                    var recovered =
                            attempts.findAllByFileIdOrderByCreatedAtAsc(latePrepared.fileId())
                                    .getFirst();
                    assertThat(recovered.getCleanupConfirmedAt()).isNotNull();
                    assertThat(recovered.getObjectKey()).isNull();
                    assertThat(
                                    provider.storage()
                                            .head(new ObjectKey(settledAttempt.getObjectKey()))
                                            .found())
                            .isFalse();
                } finally {
                    executor.shutdownNow();
                }

                assertRealRetrySelectsOneAttemptAndKeepsDistinctLoser(provider.storage());
            }
        } finally {
            makeContainerDataRemovable(seaweed);
            if (seaweed.isRunning()) seaweed.stop();
            makeRemovable(data);
            deleteTree(data);
        }
    }

    private void assertRealRetrySelectsOneAttemptAndKeepsDistinctLoser(S3ObjectStorage storage)
            throws Exception {
        FileScope scope = scope(99L, "real-concurrent-retry");
        var prepared = prepare(scope, "concurrent-retry.webp");
        BarrierObjectStorage barrier = new BarrierObjectStorage(storage);
        DefaultFileService realFiles = realService(barrier);
        try (var executor = Executors.newFixedThreadPool(2)) {
            var first =
                    executor.submit(
                            () -> realFiles.transfer(transferCommand(prepared.fileId(), scope)));
            var second =
                    executor.submit(
                            () -> realFiles.transfer(transferCommand(prepared.fileId(), scope)));
            assertThat(barrier.awaitBothPuts()).isTrue();
            var registered = attempts.findAllByFileIdOrderByCreatedAtAsc(prepared.fileId());
            assertThat(registered).hasSize(2);
            assertThat(registered)
                    .allSatisfy(
                            attempt -> {
                                assertThat(attempt.getOutcome()).isEqualTo(TransferOutcome.PENDING);
                                assertThat(attempt.getObjectKey()).isNotBlank();
                            });
            assertThat(registered.stream().map(attempt -> attempt.getObjectKey()).distinct())
                    .hasSize(2);

            barrier.releaseFirstPut();
            awaitSelectedAttempt(prepared.fileId());
            barrier.releaseSecondPut();
            List<com.krishnamurti.horizon.file.api.model.TransferResult> results =
                    List.of(first.get(10, TimeUnit.SECONDS), second.get(10, TimeUnit.SECONDS));
            assertThat(results)
                    .extracting(result -> result.disposition())
                    .contains(TransferDisposition.VERIFIED);
            assertThat(results)
                    .extracting(result -> result.disposition())
                    .contains(TransferDisposition.RETRYABLE_FAILURE);
        }
        var concurrentAttempts = attempts.findAllByFileIdOrderByCreatedAtAsc(prepared.fileId());
        assertThat(concurrentAttempts).hasSize(2);
        assertThat(concurrentAttempts.stream().map(attempt -> attempt.getObjectKey()).distinct())
                .hasSize(2);
        UUID selected = selectedAttempt(prepared.fileId());
        assertThat(concurrentAttempts.stream().filter(attempt -> attempt.getId().equals(selected)))
                .singleElement()
                .satisfies(
                        attempt ->
                                assertThat(attempt.getOutcome())
                                        .isEqualTo(TransferOutcome.VERIFIED));
        var loser =
                concurrentAttempts.stream()
                        .filter(attempt -> !attempt.getId().equals(selected))
                        .findFirst()
                        .orElseThrow();
        assertThat(loser.getOutcome()).isEqualTo(TransferOutcome.VERIFIED);
        assertThat(loser.getWriteSettledAt()).isNotNull();
        assertThat(loser.getCleanupRequestedAt()).isNotNull();
        assertThat(loser.getCleanupConfirmedAt()).isNull();
        var winner =
                concurrentAttempts.stream()
                        .filter(attempt -> attempt.getId().equals(selected))
                        .findFirst()
                        .orElseThrow();
        assertThat(barrier.putKeys()).contains(winner.getObjectKey(), loser.getObjectKey());
        assertThat(storage.head(new ObjectKey(winner.getObjectKey())).found()).isTrue();
        assertThat(storage.head(new ObjectKey(loser.getObjectKey())).found()).isTrue();
        try (StoredObject object = storage.get(new ObjectKey(winner.getObjectKey()));
                ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            object.content().transferTo(output);
            assertThat(output.toByteArray()).containsExactly(WEBP);
        }
        try (StoredObject object = storage.get(new ObjectKey(loser.getObjectKey()));
                ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            object.content().transferTo(output);
            assertThat(output.toByteArray()).containsExactly(WEBP);
        }
    }

    private void awaitSelectedAttempt(UUID fileId) throws InterruptedException {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5);
        while (selectedAttempt(fileId) == null && System.nanoTime() < deadline) {
            Thread.sleep(10);
        }
        assertThat(selectedAttempt(fileId)).isNotNull();
    }

    private UUID selectedAttempt(UUID fileId) {
        return jdbc.queryForObject(
                "select selected_attempt_id from file_metadata where id=?", UUID.class, fileId);
    }

    private void verifyDatabaseFailureBeforePut(DefaultFileService realFiles, URI endpoint) {
        FileScope scope = scope(97L, "db-fail-before-put");
        var prepared = prepare(scope, "before-put.webp");
        int existingObjects = listObjects(endpoint).contents().size();
        createFailureTrigger("BEFORE INSERT", "fail_file_attempt_insert");
        try {
            assertThatThrownBy(() -> realFiles.transfer(transferCommand(prepared.fileId(), scope)))
                    .isInstanceOf(DataAccessException.class);
        } finally {
            dropFailureObjects();
        }
        assertThat(attempts.findAllByFileIdOrderByCreatedAtAsc(prepared.fileId())).isEmpty();
        assertThat(listObjects(endpoint).contents()).hasSize(existingObjects);
    }

    private UUID verifyDatabaseFailureAfterPut(
            DefaultFileService realFiles, S3ObjectStorage storage) throws Exception {
        FileScope scope = scope(98L, "db-fail-after-put");
        var prepared = prepare(scope, "pending-after-put.webp");
        createFailureTrigger("BEFORE UPDATE", "fail_file_attempt_verified_update");
        try {
            assertThatThrownBy(() -> realFiles.transfer(transferCommand(prepared.fileId(), scope)))
                    .isInstanceOf(DataAccessException.class);
        } finally {
            dropFailureObjects();
        }
        var attempt = attempts.findAllByFileIdOrderByCreatedAtAsc(prepared.fileId()).getFirst();
        assertThat(attempt.getOutcome()).isEqualTo(TransferOutcome.PENDING);
        assertThat(attempt.getObjectKey()).isNotBlank();
        try (StoredObject object = storage.get(new ObjectKey(attempt.getObjectKey()));
                ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            object.content().transferTo(output);
            assertThat(output.toByteArray()).containsExactly(WEBP);
        }
        assertThat(
                        jdbc.queryForObject(
                                "select selected_attempt_id from file_metadata where id=?",
                                UUID.class,
                                prepared.fileId()))
                .isNull();
        return prepared.fileId();
    }

    private void createFailureTrigger(String timing, String triggerName) {
        jdbc.execute(
                "CREATE FUNCTION force_file_attempt_db_failure() RETURNS trigger LANGUAGE"
                        + " plpgsql AS $$ BEGIN IF TG_OP='INSERT' OR NEW.outcome='VERIFIED' THEN"
                        + " RAISE EXCEPTION 'forced File persistence failure'; END IF; RETURN NEW;"
                        + " END $$");
        jdbc.execute(
                "CREATE TRIGGER "
                        + triggerName
                        + " "
                        + timing
                        + " ON file_transfer_attempt FOR EACH ROW EXECUTE FUNCTION"
                        + " force_file_attempt_db_failure()");
    }

    private void dropFailureObjects() {
        jdbc.execute("DROP TRIGGER IF EXISTS fail_file_attempt_insert ON file_transfer_attempt");
        jdbc.execute(
                "DROP TRIGGER IF EXISTS fail_file_attempt_verified_update ON"
                        + " file_transfer_attempt");
        jdbc.execute("DROP FUNCTION IF EXISTS force_file_attempt_db_failure()");
    }

    private DefaultFileService realService(ObjectStorage storage) {
        return new DefaultFileService(
                metadataPersistence,
                metadataRepository,
                transactions,
                fileProperties,
                staging,
                validation,
                storage,
                metrics,
                recoveryClock);
    }

    private static final class BarrierObjectStorage implements ObjectStorage {
        private final S3ObjectStorage delegate;
        private final CountDownLatch bothPutsEntered = new CountDownLatch(2);
        private final CountDownLatch firstPutRelease = new CountDownLatch(1);
        private final CountDownLatch secondPutRelease = new CountDownLatch(1);
        private final AtomicInteger putIndex = new AtomicInteger();
        private final List<String> putKeys = new CopyOnWriteArrayList<>();

        private BarrierObjectStorage(S3ObjectStorage delegate) {
            this.delegate = delegate;
        }

        @Override
        public WriteResult put(ObjectWriteRequest request) {
            int index = putIndex.getAndIncrement();
            putKeys.add(request.key().value());
            bothPutsEntered.countDown();
            try {
                CountDownLatch release = index == 0 ? firstPutRelease : secondPutRelease;
                if (!release.await(10, TimeUnit.SECONDS)) {
                    throw new IllegalStateException("PUT barrier timed out");
                }
            } catch (InterruptedException exception) {
                Thread.currentThread().interrupt();
                throw new IllegalStateException("PUT barrier was interrupted", exception);
            }
            return delegate.put(request);
        }

        private boolean awaitBothPuts() throws InterruptedException {
            return bothPutsEntered.await(10, TimeUnit.SECONDS);
        }

        private void releaseFirstPut() {
            firstPutRelease.countDown();
        }

        private void releaseSecondPut() {
            secondPutRelease.countDown();
        }

        private List<String> putKeys() {
            return List.copyOf(putKeys);
        }

        @Override
        public ObjectMetadata head(ObjectKey key) {
            return delegate.head(key);
        }

        @Override
        public StoredObject get(ObjectKey key) {
            return delegate.get(key);
        }

        @Override
        public DeleteResult delete(ObjectKey key) {
            return delegate.delete(key);
        }

        @Override
        public void checkAvailability() {
            delegate.checkAvailability();
        }
    }

    private FileSnapshot prepare(FileScope scope, String filename) {
        FileDescriptor descriptor =
                new FileDescriptor(filename, "image/webp", WEBP.length, sha256(WEBP));
        return owner.prepare(new PrepareFileCommand(UUID.randomUUID(), scope, descriptor));
    }

    private TransferFileCommand transferCommand(java.util.UUID id, FileScope scope) {
        return new TransferFileCommand(
                new FileReference(id, scope), WEBP.length, new java.io.ByteArrayInputStream(WEBP));
    }

    private static FileScope scope(long user, String binding) {
        return FilePrepareIntegrationTest.scope(user, binding);
    }

    private static String sha256(byte[] bytes) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
        } catch (java.security.NoSuchAlgorithmException exception) {
            throw new IllegalStateException(exception);
        }
    }

    private static RealProviderFixture storage(URI endpoint) {
        return RealProviderFixture.connect(endpoint, BUCKET, ACCESS_KEY, SECRET_KEY);
    }

    private FileRecoveryWorker recoveryWorker(ObjectStorage storage) {
        return new FileRecoveryWorker(
                recoveryPersistence,
                recoveryTransactions,
                storage,
                recoveryClock,
                fileProperties,
                recoveryMetrics);
    }

    private static URI endpoint(GenericContainer<?> seaweed) {
        return URI.create("http://" + seaweed.getHost() + ":" + seaweed.getMappedPort(8333));
    }

    private static ListObjectsV2Response listObjects(URI endpoint) {
        // The public storage port deliberately has no list operation; use a separately scoped
        // authenticated S3 client only as test evidence for the isolated provider bucket.
        try (RealProviderFixture provider = storage(endpoint)) {
            return provider.listObjects();
        }
    }

    private static HttpResponse<Void> unsignedGet(URI endpoint, String key) throws Exception {
        return HttpClient.newHttpClient()
                .send(
                        HttpRequest.newBuilder(endpoint.resolve("/" + BUCKET + "/" + key))
                                .GET()
                                .build(),
                        HttpResponse.BodyHandlers.discarding());
    }

    private static byte[] fixture(String resource) {
        try (var input =
                FileRealProviderIntegrationTest.class
                        .getClassLoader()
                        .getResourceAsStream(resource)) {
            if (input == null) throw new IllegalStateException("Missing fixture " + resource);
            return input.readAllBytes();
        } catch (java.io.IOException exception) {
            throw new java.io.UncheckedIOException(exception);
        }
    }

    private static void makeRemovable(Path root) {
        try (var paths = Files.walk(root)) {
            paths.forEach(path -> path.toFile().setWritable(true));
        } catch (java.io.IOException ignored) {
            // Cleanup continues; deleteTree reports any remaining owned temporary files.
        }
    }

    private static void makeContainerDataRemovable(GenericContainer<?> container) {
        try {
            if (!container.isRunning()) container.start();
            var result = container.execInContainer("sh", "-c", "chmod -R a+rwX /data");
            if (result.getExitCode() != 0) {
                throw new IllegalStateException(
                        "Could not make temporary SeaweedFS data removable: " + result.getStderr());
            }
        } catch (java.io.IOException exception) {
            throw new java.io.UncheckedIOException(exception);
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException(
                    "Interrupted while preparing SeaweedFS cleanup", exception);
        }
    }

    private static void deleteTree(Path root) throws Exception {
        if (!Files.exists(root)) return;
        try (var paths = Files.walk(root)) {
            for (Path path : paths.sorted(java.util.Comparator.reverseOrder()).toList()) {
                Files.deleteIfExists(path);
            }
        }
    }
}
