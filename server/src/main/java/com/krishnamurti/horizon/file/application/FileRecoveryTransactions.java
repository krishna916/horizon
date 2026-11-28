package com.krishnamurti.horizon.file.application;

import com.krishnamurti.horizon.file.application.port.ObjectKey;
import com.krishnamurti.horizon.file.domain.FileMetadataEntity;
import com.krishnamurti.horizon.file.domain.FileTransferAttemptEntity;
import com.krishnamurti.horizon.file.domain.TransferOutcome;
import com.krishnamurti.horizon.file.infrastructure.FileProperties;
import com.krishnamurti.horizon.file.infrastructure.persistence.FileMetadataRepository;
import com.krishnamurti.horizon.file.infrastructure.persistence.FileRecoveryPersistence;
import com.krishnamurti.horizon.file.infrastructure.persistence.FileTransferAttemptRepository;
import java.time.Instant;
import java.util.Objects;
import java.util.Optional;
import java.util.UUID;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

@Component
public class FileRecoveryTransactions {
    public record DeleteClaim(
            UUID fileId,
            UUID attemptId,
            ObjectKey key,
            UUID token,
            Instant leaseUntil,
            boolean settledAtClaim) {}

    private final FileRecoveryPersistence recovery;
    private final FileMetadataRepository files;
    private final FileTransferAttemptRepository attempts;
    private final RecoveryClock clock;
    private final FileProperties properties;

    public FileRecoveryTransactions(
            FileRecoveryPersistence recovery,
            FileMetadataRepository files,
            FileTransferAttemptRepository attempts,
            RecoveryClock clock,
            FileProperties properties) {
        this.recovery = recovery;
        this.files = files;
        this.attempts = attempts;
        this.clock = clock;
        this.properties = properties;
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public boolean recordExpiry(UUID fileId) {
        if (!recovery.lockFileIfAvailable(fileId)) return false;
        FileMetadataEntity file = files.findById(fileId).orElseThrow();
        Instant now = clock.now();
        if (file.getClaimedAt() != null
                || file.getCleanupRequestedAt() != null
                || file.getPurgedAt() != null
                || file.getExpiryRecordedAt() != null
                || now.isBefore(file.getExpiresAt())) return false;
        file.setExpiryRecordedAt(now);
        file.setUpdatedAt(now);
        files.saveAndFlush(file);
        return true;
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public Optional<DeleteClaim> claimDelete(UUID fileId, UUID attemptId) {
        if (!recovery.lockFileIfAvailable(fileId)) return Optional.empty();
        FileMetadataEntity file = files.findById(fileId).orElseThrow();
        FileTransferAttemptEntity attempt =
                attempts.lockByFileIdAndId(fileId, attemptId).orElse(null);
        if (attempt == null) return Optional.empty();
        Instant now = clock.now();
        if (file.getPurgedAt() != null
                || attempt.getObjectKey() == null
                || attempt.getCleanupConfirmedAt() != null) return Optional.empty();
        boolean parentFenced =
                file.getCleanupRequestedAt() != null || file.getExpiryRecordedAt() != null;
        boolean liveSelected =
                Objects.equals(file.getSelectedAttemptId(), attemptId)
                        && !parentFenced
                        && (file.getClaimedAt() != null || now.isBefore(file.getExpiresAt()));
        if (liveSelected) return Optional.empty();
        // Expiry must become durable before any attempt can be deleted.
        if (!parentFenced && file.getClaimedAt() == null && !now.isBefore(file.getExpiresAt()))
            return Optional.empty();
        boolean eligible =
                parentFenced
                        || attempt.getCleanupRequestedAt() != null
                        || (file.getSelectedAttemptId() != null
                                && !Objects.equals(file.getSelectedAttemptId(), attemptId))
                        || (attempt.getOutcome() == TransferOutcome.FAILED
                                && attempt.getWriteSettledAt() != null);
        if (!eligible
                || (attempt.getCleanupLeaseUntil() != null
                        && now.isBefore(attempt.getCleanupLeaseUntil()))) return Optional.empty();
        Instant due =
                attempt.getNextCleanupAt() != null
                        ? attempt.getNextCleanupAt()
                        : (attempt.getCleanupRequestedAt() != null
                                ? attempt.getCleanupRequestedAt()
                                : attempt.getCreatedAt());
        if (now.isBefore(due)) return Optional.empty();
        if (attempt.getCleanupRequestedAt() == null) attempt.setCleanupRequestedAt(now);
        if (attempt.getOutcome() == TransferOutcome.PENDING && attempt.getWriteSettledAt() == null)
            attempt.setOutcome(TransferOutcome.UNKNOWN);
        UUID token = UUID.randomUUID();
        Instant lease = now.plus(properties.getRecovery().getLeaseDuration());
        attempt.setCleanupLeaseToken(token);
        attempt.setCleanupLeaseUntil(lease);
        if (attempt.getCleanupAttemptCount() < Long.MAX_VALUE)
            attempt.setCleanupAttemptCount(attempt.getCleanupAttemptCount() + 1);
        attempt.setLastCleanupAttemptAt(now);
        attempt.setUpdatedAt(now);
        attempts.saveAndFlush(attempt);
        return Optional.of(
                new DeleteClaim(
                        fileId,
                        attemptId,
                        new ObjectKey(attempt.getObjectKey()),
                        token,
                        lease,
                        attempt.getWriteSettledAt() != null));
    }
}
