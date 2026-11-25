package com.krishnamurti.horizon.file.application;

import com.krishnamurti.horizon.file.api.model.ClaimResult;
import com.krishnamurti.horizon.file.api.model.FileFormat;
import com.krishnamurti.horizon.file.api.model.FileLifecycle;
import com.krishnamurti.horizon.file.api.model.FileMetadata;
import com.krishnamurti.horizon.file.api.model.FileReference;
import com.krishnamurti.horizon.file.api.model.FileScope;
import com.krishnamurti.horizon.file.api.model.FileSnapshot;
import com.krishnamurti.horizon.file.application.port.ObjectKey;
import com.krishnamurti.horizon.file.domain.FileLifecyclePolicy;
import com.krishnamurti.horizon.file.domain.FileMetadataEntity;
import com.krishnamurti.horizon.file.domain.FileTransferAttemptEntity;
import com.krishnamurti.horizon.file.domain.TransferOutcome;
import com.krishnamurti.horizon.file.infrastructure.persistence.FileMetadataRepository;
import com.krishnamurti.horizon.file.infrastructure.persistence.FileTransferAttemptRepository;
import java.time.Instant;
import java.util.Objects;
import java.util.UUID;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/** Short database transactions used by FileService around external object-store I/O. */
@Component
public class FileTransactions {
    private final FileMetadataRepository files;
    private final FileTransferAttemptRepository attempts;

    public FileTransactions(FileMetadataRepository files, FileTransferAttemptRepository attempts) {
        this.files = files;
        this.attempts = attempts;
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW, readOnly = true)
    public FileMetadataEntity loadTransferFile(FileReference reference) {
        return scoped(reference).orElseThrow(FileTransactions::notFound);
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public Registration registerAttempt(FileReference reference) {
        FileMetadataEntity file =
                files.lockById(reference.fileId()).orElseThrow(FileTransactions::notFound);
        requireScope(file, reference.scope());
        Instant now = Instant.now();
        FileLifecycle lifecycle = lifecycle(file, now);
        if (lifecycle == FileLifecycle.VERIFIED && file.getSelectedAttemptId() != null) {
            return Registration.alreadyVerified(snapshot(file, now));
        }
        requirePrepared(file, lifecycle);

        UUID attemptId = UUID.randomUUID();
        String keyValue = "users/" + file.getUserId() + "/" + file.getWorkspace() + "/" + attemptId;
        ObjectKey key = new ObjectKey(keyValue);
        FileTransferAttemptEntity attempt =
                FileTransferAttemptEntity.createPending(
                        attemptId,
                        file.getId(),
                        key.value(),
                        file.getExpectedSizeBytes(),
                        file.getExpectedSha256(),
                        now);
        attempts.saveAndFlush(attempt);
        return new Registration(false, snapshot(file, now), attemptId, key);
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public Completion recordAttempt(
            FileReference reference,
            UUID attemptId,
            AttemptResult result,
            FileFormat verifiedFormat) {
        FileMetadataEntity file =
                files.lockById(reference.fileId()).orElseThrow(FileTransactions::notFound);
        requireScope(file, reference.scope());
        FileTransferAttemptEntity attempt =
                attempts.lockByFileIdAndId(file.getId(), attemptId)
                        .orElseThrow(FileTransactions::notFound);
        Instant now = Instant.now();
        attempt.setOutcome(result.outcome());
        attempt.setUpdatedAt(now);
        if (result.writeSettled()) attempt.setWriteSettledAt(now);
        if (result.verified()) {
            attempt.setVerifiedSizeBytes(result.verifiedSizeBytes());
            attempt.setVerifiedSha256(result.verifiedSha256());
            attempt.setVerifiedAt(now);
        }

        boolean selected = false;
        if (result.verified()) {
            FileLifecycle lifecycle = lifecycle(file, now);
            if (file.getSelectedAttemptId() == null
                    && (lifecycle == FileLifecycle.PREPARED
                            || lifecycle == FileLifecycle.VERIFIED)) {
                file.setSelectedAttemptId(attemptId);
                file.setValidatedFormat(Objects.requireNonNull(verifiedFormat));
                file.setUpdatedAt(now);
                selected = true;
            } else {
                attempt.setCleanupRequestedAt(now);
            }
        } else if (result.cleanupRequested()) {
            attempt.setCleanupRequestedAt(now);
        }
        attempts.saveAndFlush(attempt);
        files.saveAndFlush(file);
        return new Completion(snapshot(file, now), selected);
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public ClaimResult claim(FileReference reference) {
        FileMetadataEntity file =
                files.lockById(reference.fileId()).orElseThrow(FileTransactions::notFound);
        requireScope(file, reference.scope());
        Instant now = Instant.now();
        FileLifecycle lifecycle = lifecycle(file, now);
        if (lifecycle == FileLifecycle.CLAIMED) return ClaimResult.ALREADY_CLAIMED;
        if (lifecycle != FileLifecycle.VERIFIED || file.getSelectedAttemptId() == null) {
            throw new IllegalStateException("File is not eligible to be claimed");
        }
        FileTransferAttemptEntity selected =
                attempts.lockByFileIdAndId(file.getId(), file.getSelectedAttemptId())
                        .orElseThrow(FileTransactions::notFound);
        if (selected.getOutcome() != TransferOutcome.VERIFIED
                || selected.getObjectKey() == null
                || !Objects.equals(selected.getVerifiedSizeBytes(), file.getExpectedSizeBytes())
                || !Objects.equals(selected.getVerifiedSha256(), file.getExpectedSha256())) {
            throw new IllegalStateException("File is not eligible to be claimed");
        }
        file.setClaimedAt(now);
        file.setUpdatedAt(now);
        files.saveAndFlush(file);
        return ClaimResult.CLAIMED;
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW, readOnly = true)
    public ReadSnapshot loadClaimedFile(FileReference reference) {
        FileMetadataEntity file = scoped(reference).orElseThrow(FileTransactions::notFound);
        Instant now = Instant.now();
        if (lifecycle(file, now) != FileLifecycle.CLAIMED
                || file.getClaimedAt() == null
                || file.getSelectedAttemptId() == null) {
            throw new IllegalStateException("File content is not available");
        }
        FileTransferAttemptEntity selected =
                attempts.findByFileIdAndId(file.getId(), file.getSelectedAttemptId())
                        .orElseThrow(FileTransactions::notFound);
        if (selected.getOutcome() != TransferOutcome.VERIFIED
                || selected.getObjectKey() == null
                || !Objects.equals(selected.getVerifiedSizeBytes(), file.getExpectedSizeBytes())
                || !Objects.equals(selected.getVerifiedSha256(), file.getExpectedSha256())) {
            throw new IllegalStateException("File content is not available");
        }
        FileMetadata metadata =
                new FileMetadata(
                        file.getOriginalFilename(),
                        file.getDeclaredContentType(),
                        file.getValidatedFormat(),
                        file.getExpectedSizeBytes(),
                        file.getExpectedSha256());
        return new ReadSnapshot(
                metadata, new ObjectKey(selected.getObjectKey()), selected.getVerifiedSizeBytes());
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public void requestCleanup(FileReference reference) {
        FileMetadataEntity file =
                files.lockById(reference.fileId()).orElseThrow(FileTransactions::notFound);
        requireScope(file, reference.scope());
        if (file.getPurgedAt() != null) return;
        Instant now = Instant.now();
        if (file.getCleanupRequestedAt() == null) file.setCleanupRequestedAt(now);
        file.setUpdatedAt(now);
        for (FileTransferAttemptEntity attempt :
                attempts.findAllByFileIdOrderByCreatedAtAsc(file.getId())) {
            if (attempt.getWriteSettledAt() != null && attempt.getCleanupRequestedAt() == null) {
                attempt.setCleanupRequestedAt(now);
                attempt.setUpdatedAt(now);
                attempts.save(attempt);
            }
        }
        files.saveAndFlush(file);
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW, readOnly = true)
    public FileSnapshot inspect(FileReference reference) {
        FileMetadataEntity file = scoped(reference).orElseThrow(FileTransactions::notFound);
        return snapshot(file, Instant.now());
    }

    private java.util.Optional<FileMetadataEntity> scoped(FileReference reference) {
        FileScope scope = reference.scope();
        return files.findByIdAndUserIdAndWorkspaceAndBindingFingerprint(
                reference.fileId(), scope.userId(), scope.workspace(), scope.bindingFingerprint());
    }

    private static void requireScope(FileMetadataEntity file, FileScope scope) {
        if (!file.getUserId().equals(scope.userId())
                || !file.getWorkspace().equals(scope.workspace())
                || !file.getBindingFingerprint().equals(scope.bindingFingerprint())) {
            throw notFound();
        }
    }

    private static void requirePrepared(FileMetadataEntity file, FileLifecycle lifecycle) {
        if (lifecycle != FileLifecycle.PREPARED || file.getExpectedSizeBytes() == null) {
            throw new IllegalStateException("File transfer is not eligible");
        }
    }

    private static FileLifecycle lifecycle(FileMetadataEntity file, Instant now) {
        return FileLifecyclePolicy.derive(
                now,
                file.getExpiresAt(),
                file.getSelectedAttemptId(),
                file.getClaimedAt(),
                file.getCleanupRequestedAt(),
                file.getPurgedAt());
    }

    static FileSnapshot snapshot(FileMetadataEntity file, Instant now) {
        FileMetadata metadata = null;
        if (file.getPurgedAt() == null) {
            metadata =
                    new FileMetadata(
                            file.getOriginalFilename(),
                            file.getDeclaredContentType(),
                            file.getValidatedFormat(),
                            file.getExpectedSizeBytes() == null ? 0 : file.getExpectedSizeBytes(),
                            file.getExpectedSha256());
        }
        return new FileSnapshot(
                file.getId(),
                lifecycle(file, now),
                metadata,
                file.getCreatedAt(),
                file.getExpiresAt(),
                file.getClaimedAt(),
                file.getCleanupRequestedAt());
    }

    private static IllegalArgumentException notFound() {
        return new IllegalArgumentException("File not found");
    }

    public record Registration(
            boolean alreadyVerified, FileSnapshot snapshot, UUID attemptId, ObjectKey key) {
        static Registration alreadyVerified(FileSnapshot snapshot) {
            return new Registration(true, snapshot, null, null);
        }
    }

    public record AttemptResult(
            TransferOutcome outcome,
            boolean writeSettled,
            boolean verified,
            boolean cleanupRequested,
            Long verifiedSizeBytes,
            String verifiedSha256) {
        public AttemptResult {
            Objects.requireNonNull(outcome);
            if (verified && (verifiedSizeBytes == null || verifiedSha256 == null)) {
                throw new IllegalArgumentException("verified attempt needs exact remote identity");
            }
        }

        public static AttemptResult unknown() {
            return new AttemptResult(TransferOutcome.UNKNOWN, false, false, false, null, null);
        }

        public static AttemptResult failed(boolean cleanupRequested) {
            return new AttemptResult(
                    TransferOutcome.FAILED, true, false, cleanupRequested, null, null);
        }

        public static AttemptResult verified(long size, String sha256) {
            return new AttemptResult(TransferOutcome.VERIFIED, true, true, false, size, sha256);
        }
    }

    public record Completion(FileSnapshot snapshot, boolean selected) {}

    public record ReadSnapshot(FileMetadata metadata, ObjectKey key, long verifiedSizeBytes) {}
}
