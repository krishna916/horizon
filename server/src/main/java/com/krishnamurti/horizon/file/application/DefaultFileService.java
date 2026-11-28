package com.krishnamurti.horizon.file.application;

import com.krishnamurti.horizon.file.api.FileOperationException;
import com.krishnamurti.horizon.file.api.FileService;
import com.krishnamurti.horizon.file.api.command.ClaimFileCommand;
import com.krishnamurti.horizon.file.api.command.CleanupFileCommand;
import com.krishnamurti.horizon.file.api.command.PrepareFileCommand;
import com.krishnamurti.horizon.file.api.command.TransferFileCommand;
import com.krishnamurti.horizon.file.api.model.ClaimResult;
import com.krishnamurti.horizon.file.api.model.FileContent;
import com.krishnamurti.horizon.file.api.model.FileDescriptor;
import com.krishnamurti.horizon.file.api.model.FileLifecycle;
import com.krishnamurti.horizon.file.api.model.FileReference;
import com.krishnamurti.horizon.file.api.model.FileSnapshot;
import com.krishnamurti.horizon.file.api.model.TransferDisposition;
import com.krishnamurti.horizon.file.api.model.TransferResult;
import com.krishnamurti.horizon.file.api.query.InspectFileQuery;
import com.krishnamurti.horizon.file.api.query.ReadFileQuery;
import com.krishnamurti.horizon.file.application.port.ObjectNotFoundException;
import com.krishnamurti.horizon.file.application.port.ObjectStorage;
import com.krishnamurti.horizon.file.application.port.ObjectWriteRequest;
import com.krishnamurti.horizon.file.application.port.StoredObject;
import com.krishnamurti.horizon.file.application.port.WriteResult;
import com.krishnamurti.horizon.file.domain.FileLifecyclePolicy;
import com.krishnamurti.horizon.file.domain.FileMetadataEntity;
import com.krishnamurti.horizon.file.domain.FileRequestFingerprint;
import com.krishnamurti.horizon.file.infrastructure.FileMetrics;
import com.krishnamurti.horizon.file.infrastructure.FileProperties;
import com.krishnamurti.horizon.file.infrastructure.persistence.FileMetadataPersistence;
import com.krishnamurti.horizon.file.infrastructure.persistence.FileMetadataRepository;
import com.krishnamurti.horizon.file.infrastructure.staging.FileStagingService;
import com.krishnamurti.horizon.file.infrastructure.staging.StagedFile;
import com.krishnamurti.horizon.file.infrastructure.validation.FileValidationService;
import com.krishnamurti.horizon.file.infrastructure.validation.ValidationResult;
import edu.umd.cs.findbugs.annotations.SuppressFBWarnings;
import java.io.FilterInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Instant;
import java.util.HexFormat;
import java.util.Objects;
import java.util.UUID;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.ScheduledThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/** File use cases. Caller-owned operations and remote I/O have deliberately separate boundaries. */
@Service
@SuppressFBWarnings(
        value = "EI_EXPOSE_REP2",
        justification = "Dependencies are private, final Spring-managed collaborators.")
public class DefaultFileService implements FileService {
    private static final ScheduledExecutorService VERIFICATION_DEADLINES =
            verificationDeadlineExecutor();
    private static final short FINGERPRINT_VERSION = 1;
    private final FileMetadataPersistence metadataPersistence;
    private final FileMetadataRepository metadataRepository;
    private final FileTransactions transactions;
    private final FileProperties properties;
    private final FileStagingService staging;
    private final FileValidationService validation;
    private final ObjectStorage storage;
    private final FileMetrics metrics;
    private final RecoveryClock clock;

    public DefaultFileService(
            FileMetadataPersistence metadataPersistence,
            FileMetadataRepository metadataRepository,
            FileTransactions transactions,
            FileProperties properties,
            FileStagingService staging,
            FileValidationService validation,
            ObjectStorage storage,
            FileMetrics metrics,
            RecoveryClock clock) {
        this.metadataPersistence = metadataPersistence;
        this.metadataRepository = metadataRepository;
        this.transactions = transactions;
        this.properties = properties;
        this.staging = staging;
        this.validation = validation;
        this.storage = storage;
        this.metrics = metrics;
        this.clock = clock;
    }

    @Override
    @Transactional(propagation = Propagation.MANDATORY)
    public FileSnapshot prepare(PrepareFileCommand command) {
        Objects.requireNonNull(command);
        String fingerprint = FileRequestFingerprint.compute(command.scope(), command.descriptor());
        var existing = metadataRepository.findByIdempotencyKey(command.idempotencyKey());
        if (existing.isPresent()) {
            return requireSameRequest(existing.get(), command, fingerprint);
        }
        if (command.descriptor().expectedSize() > properties.getMaxFileSizeBytes()) {
            throw failure(
                    FileOperationException.Reason.SIZE_LIMIT_EXCEEDED,
                    "File exceeds the effective upload limit");
        }

        Instant createdAt = clock.now();
        FileMetadataEntity candidate =
                FileMetadataEntity.createReservation(
                        UUID.randomUUID(),
                        command.scope().userId(),
                        command.scope().workspace(),
                        command.idempotencyKey(),
                        command.scope().bindingFingerprint(),
                        fingerprint,
                        FINGERPRINT_VERSION,
                        command.descriptor().originalFilename(),
                        command.descriptor().declaredContentType(),
                        command.descriptor().expectedSize(),
                        command.descriptor().expectedSha256(),
                        createdAt,
                        createdAt.plus(properties.getUnclaimedExpiry()));
        FileMetadataEntity persisted = metadataPersistence.insertOrFind(candidate);
        if (!persisted.getId().equals(candidate.getId())) {
            return requireSameRequest(persisted, command, fingerprint);
        }
        return FileTransactions.snapshot(persisted, createdAt);
    }

    @Override
    @Transactional(propagation = Propagation.NEVER)
    public TransferResult transfer(TransferFileCommand command) {
        return metrics.observeTransfer(() -> performTransfer(command));
    }

    private TransferResult performTransfer(TransferFileCommand command) {
        Objects.requireNonNull(command);
        FileReference reference = command.file();
        FileMetadataEntity file = transactions.loadTransferFile(reference);
        Instant now = clock.now();
        FileLifecycle lifecycle = lifecycle(file, now);
        if (lifecycle == FileLifecycle.VERIFIED && file.getSelectedAttemptId() != null) {
            if (command.contentLength() <= 0
                    || !Objects.equals(command.contentLength(), file.getExpectedSizeBytes())) {
                throw failure(
                        FileOperationException.Reason.INVALID_METADATA,
                        "File content length does not match the verified file");
            }
            return new TransferResult(
                    TransferDisposition.ALREADY_VERIFIED, FileTransactions.snapshot(file, now));
        }
        if (lifecycle != FileLifecycle.PREPARED) {
            throw failure(FileOperationException.Reason.CONFLICT, "File transfer is not eligible");
        }
        if (file.getExpectedSizeBytes() == null
                || file.getExpectedSizeBytes() > properties.getMaxFileSizeBytes()) {
            throw failure(
                    FileOperationException.Reason.SIZE_LIMIT_EXCEEDED,
                    "File exceeds the effective upload limit");
        }
        FileDescriptor descriptor = descriptor(file);

        try (StagedFile staged =
                staging.stage(command.content(), command.contentLength(), descriptor)) {
            ValidationResult validated;
            try {
                validated = validation.validate(staged, descriptor);
            } catch (IllegalArgumentException | IOException rejected) {
                metrics.validationRejected();
                throw rejected;
            }
            FileTransactions.Registration registration = transactions.registerAttempt(reference);
            if (registration.alreadyVerified()) {
                return new TransferResult(
                        TransferDisposition.ALREADY_VERIFIED, registration.snapshot());
            }

            WriteResult writeResult;
            try {
                writeResult =
                        Objects.requireNonNull(
                                storage.put(
                                        new ObjectWriteRequest(
                                                registration.key(),
                                                staged.path(),
                                                staged.sizeBytes(),
                                                validated.mediaType())));
            } catch (RuntimeException ambiguousFailure) {
                writeResult = WriteResult.UNKNOWN;
            }
            if (writeResult == WriteResult.UNKNOWN) {
                metrics.storageError("put");
                FileTransactions.Completion completion =
                        transactions.recordAttempt(
                                reference,
                                registration.attemptId(),
                                FileTransactions.AttemptResult.unknown(),
                                null);
                return new TransferResult(
                        TransferDisposition.OUTCOME_UNKNOWN, completion.snapshot());
            }
            if (writeResult == WriteResult.FAILED_SETTLED) {
                FileTransactions.Completion completion =
                        transactions.recordAttempt(
                                reference,
                                registration.attemptId(),
                                FileTransactions.AttemptResult.failed(false),
                                null);
                return new TransferResult(
                        TransferDisposition.RETRYABLE_FAILURE, completion.snapshot());
            }

            Verification verified;
            try {
                verified = verifyRemote(registration.key(), staged.sizeBytes(), staged.sha256());
            } catch (IOException | RuntimeException verificationFailure) {
                if (verificationFailure instanceof RuntimeException) metrics.storageError("get");
                FileTransactions.Completion completion =
                        transactions.recordAttempt(
                                reference,
                                registration.attemptId(),
                                FileTransactions.AttemptResult.failed(true),
                                null);
                return new TransferResult(
                        TransferDisposition.RETRYABLE_FAILURE, completion.snapshot());
            }
            FileTransactions.Completion completion =
                    transactions.recordAttempt(
                            reference,
                            registration.attemptId(),
                            FileTransactions.AttemptResult.verified(
                                    verified.sizeBytes(), verified.sha256()),
                            validated.format());
            return new TransferResult(
                    completion.selected()
                            ? TransferDisposition.VERIFIED
                            : TransferDisposition.RETRYABLE_FAILURE,
                    completion.snapshot());
        } catch (IllegalArgumentException e) {
            throw failure(
                    FileOperationException.Reason.INVALID_CONTENT, "File content is invalid", e);
        } catch (IOException e) {
            throw failure(
                    FileOperationException.Reason.STORAGE_UNAVAILABLE,
                    "File content could not be staged or validated",
                    e);
        }
    }

    @Override
    @Transactional(propagation = Propagation.NEVER, readOnly = true)
    public FileSnapshot inspect(InspectFileQuery query) {
        Objects.requireNonNull(query);
        return transactions.inspect(query.file());
    }

    @Override
    @Transactional(propagation = Propagation.MANDATORY)
    public ClaimResult claim(ClaimFileCommand command) {
        Objects.requireNonNull(command);
        return transactions.claim(command.file());
    }

    @Override
    @Transactional(propagation = Propagation.NEVER, readOnly = true)
    public FileContent openRead(ReadFileQuery query) {
        Objects.requireNonNull(query);
        FileTransactions.ReadSnapshot snapshot = transactions.loadClaimedFile(query.file());
        StoredObject stored;
        try {
            stored = storage.get(snapshot.key());
        } catch (ObjectNotFoundException e) {
            metrics.storageError("get");
            throw failure(
                    FileOperationException.Reason.CONTENT_UNAVAILABLE,
                    "File content is unavailable",
                    e);
        } catch (RuntimeException e) {
            metrics.storageError("get");
            throw failure(
                    FileOperationException.Reason.STORAGE_UNAVAILABLE,
                    "File content is unavailable",
                    e);
        }
        if (stored.contentLength() != snapshot.verifiedSizeBytes()) {
            metrics.storageError("get");
            closeQuietly(stored);
            throw failure(
                    FileOperationException.Reason.CONTENT_UNAVAILABLE,
                    "File content is unavailable");
        }
        InputStream stream =
                new FilterInputStream(stored.content()) {
                    private boolean closed;

                    @Override
                    public void close() throws IOException {
                        if (!closed) {
                            closed = true;
                            stored.close();
                        }
                    }
                };
        return new FileContent(snapshot.metadata(), stream);
    }

    @Override
    @Transactional(propagation = Propagation.MANDATORY)
    public void requestCleanup(CleanupFileCommand command) {
        Objects.requireNonNull(command);
        transactions.requestCleanup(command.file());
    }

    private static void closeQuietly(StoredObject stored) {
        try {
            stored.close();
        } catch (IOException ignored) {
            // The response will not be exposed; retain the safe semantic read failure.
        }
    }

    private FileSnapshot requireSameRequest(
            FileMetadataEntity existing, PrepareFileCommand command, String fingerprint) {
        if (existing.getFingerprintVersion() != FINGERPRINT_VERSION
                || !existing.getRequestFingerprint().equals(fingerprint)
                || !existing.getUserId().equals(command.scope().userId())
                || !existing.getWorkspace().equals(command.scope().workspace())
                || !existing.getBindingFingerprint().equals(command.scope().bindingFingerprint())) {
            throw failure(FileOperationException.Reason.CONFLICT, "Conflicting file reservation");
        }
        return FileTransactions.snapshot(existing, clock.now());
    }

    private static FileDescriptor descriptor(FileMetadataEntity file) {
        return new FileDescriptor(
                file.getOriginalFilename(),
                file.getDeclaredContentType(),
                file.getExpectedSizeBytes(),
                file.getExpectedSha256());
    }

    private static FileLifecycle lifecycle(FileMetadataEntity file, Instant now) {
        return FileLifecyclePolicy.derive(
                now,
                file.getExpiresAt(),
                file.getExpiryRecordedAt(),
                file.getSelectedAttemptId(),
                file.getClaimedAt(),
                file.getCleanupRequestedAt(),
                file.getPurgedAt());
    }

    private Verification verifyRemote(
            com.krishnamurti.horizon.file.application.port.ObjectKey key,
            long expectedSize,
            String expectedSha256)
            throws IOException {
        MessageDigest digest = sha256();
        long total = 0;
        byte[] buffer = new byte[properties.getStaging().getCopyBufferSize()];
        long timeoutNanos = properties.getStorage().getS3().getOperationTimeout().toNanos();
        long startedNanos = System.nanoTime();
        StoredObject remote = storage.get(key);
        AtomicBoolean deadlineExceeded = new AtomicBoolean();
        AtomicBoolean finished = new AtomicBoolean();
        boolean verified = false;
        ScheduledFuture<?> abortTask = null;
        try {
            long elapsedNanos = System.nanoTime() - startedNanos;
            long remainingNanos = timeoutNanos - elapsedNanos;
            if (remainingNanos <= 0) {
                deadlineExceeded.set(true);
                remote.abort();
                throw new IOException("Remote object verification exceeded its operation deadline");
            }
            abortTask =
                    VERIFICATION_DEADLINES.schedule(
                            () -> {
                                if (finished.compareAndSet(false, true)) {
                                    deadlineExceeded.set(true);
                                    remote.abort();
                                }
                            },
                            remainingNanos,
                            TimeUnit.NANOSECONDS);
            if (remote.contentLength() != expectedSize) {
                throw new IOException("Remote object length does not match the staged file");
            }
            InputStream content = remote.content();
            while (total < expectedSize) {
                int requested = (int) Math.min(buffer.length, expectedSize - total);
                int read = content.read(buffer, 0, requested);
                if (read < 0)
                    throw new IOException("Remote object ended before the expected length");
                if (read == 0) {
                    int oneByte = content.read();
                    if (oneByte < 0)
                        throw new IOException("Remote object ended before the expected length");
                    digest.update((byte) oneByte);
                    total++;
                    continue;
                }
                digest.update(buffer, 0, read);
                total = Math.addExact(total, read);
            }
            if (content.read() >= 0)
                throw new IOException("Remote object exceeds the expected length");
            if (System.nanoTime() - startedNanos >= timeoutNanos) {
                deadlineExceeded.set(true);
            }
            if (deadlineExceeded.get() || !finished.compareAndSet(false, true)) {
                throw new IOException("Remote object verification exceeded its operation deadline");
            }
            verified = true;
        } finally {
            if (abortTask != null) abortTask.cancel(false);
            if (verified) remote.close();
            else remote.abort();
        }
        String actualSha256 = HexFormat.of().formatHex(digest.digest());
        if (!MessageDigest.isEqual(
                actualSha256.getBytes(java.nio.charset.StandardCharsets.US_ASCII),
                expectedSha256.getBytes(java.nio.charset.StandardCharsets.US_ASCII))) {
            throw new IOException("Remote object checksum does not match the staged file");
        }
        return new Verification(total, actualSha256);
    }

    private static MessageDigest sha256() {
        try {
            return MessageDigest.getInstance("SHA-256");
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 is unavailable", e);
        }
    }

    private static ScheduledThreadPoolExecutor verificationDeadlineExecutor() {
        ScheduledThreadPoolExecutor executor =
                new ScheduledThreadPoolExecutor(
                        1,
                        Thread.ofPlatform()
                                .daemon()
                                .name("horizon-file-verification-deadline")
                                .factory());
        executor.setRemoveOnCancelPolicy(true);
        return executor;
    }

    private static FileOperationException failure(
            FileOperationException.Reason reason, String message) {
        return new FileOperationException(reason, message);
    }

    private static FileOperationException failure(
            FileOperationException.Reason reason, String message, Throwable cause) {
        return new FileOperationException(reason, message, cause);
    }

    private record Verification(long sizeBytes, String sha256) {}
}
