package com.krishnamurti.horizon.file.application;

import com.krishnamurti.horizon.file.application.port.ObjectKey;
import com.krishnamurti.horizon.file.domain.FileMetadataEntity;
import com.krishnamurti.horizon.file.domain.FileRecoveryBackoff;
import com.krishnamurti.horizon.file.domain.FileTransferAttemptEntity;
import com.krishnamurti.horizon.file.domain.TransferOutcome;
import com.krishnamurti.horizon.file.infrastructure.FileProperties;
import com.krishnamurti.horizon.file.infrastructure.persistence.FileMetadataRepository;
import com.krishnamurti.horizon.file.infrastructure.persistence.FileRecoveryPersistence;
import com.krishnamurti.horizon.file.infrastructure.persistence.FileTransferAttemptRepository;
import edu.umd.cs.findbugs.annotations.SuppressFBWarnings;
import java.security.SecureRandom;
import java.time.Instant;
import java.util.Objects;
import java.util.Optional;
import java.util.UUID;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

@Component
public class FileRecoveryTransactions {
    private static final SecureRandom RETRY_JITTER = new SecureRandom();

    public record DeleteClaim(
            UUID fileId,
            UUID attemptId,
            ObjectKey key,
            UUID token,
            Instant leaseUntil,
            boolean settledAtClaim,
            boolean reclaimedLease) {}

    private final FileRecoveryPersistence recovery;
    private final FileMetadataRepository files;
    private final FileTransferAttemptRepository attempts;
    private final RecoveryClock clock;
    private final FileProperties properties;

    @SuppressFBWarnings(
            value = "EI_EXPOSE_REP2",
            justification =
                    "The injected collaborators are private final Spring-managed dependencies.")
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
        boolean reclaimed = attempt.getCleanupLeaseToken() != null;
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
                        attempt.getWriteSettledAt() != null,
                        reclaimed));
    }

    public enum CleanupError {
        STORAGE_UNAVAILABLE,
        DELETE_FAILED,
        DB_RETRY
    }

    public enum CompletionDisposition {
        STALE,
        RETRY_SCHEDULED,
        UNKNOWN_REVISIT,
        TERMINAL_CONFIRMED
    }

    public record DeleteCompletion(boolean acknowledged, CleanupError error) {
        public DeleteCompletion {
            if (acknowledged == (error != null))
                throw new IllegalArgumentException("Exactly one delete result is required");
        }

        public static DeleteCompletion ack() {
            return new DeleteCompletion(true, null);
        }

        public static DeleteCompletion failed(CleanupError error) {
            return new DeleteCompletion(false, Objects.requireNonNull(error));
        }
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public CompletionDisposition completeDelete(DeleteClaim claim, DeleteCompletion completion) {
        Objects.requireNonNull(claim);
        Objects.requireNonNull(completion);
        FileMetadataEntity file = files.lockById(claim.fileId()).orElse(null);
        if (file == null) return CompletionDisposition.STALE;
        FileTransferAttemptEntity attempt =
                attempts.lockByFileIdAndId(claim.fileId(), claim.attemptId()).orElse(null);
        if (attempt == null) return CompletionDisposition.STALE;
        Instant now = clock.now();
        if (!Objects.equals(attempt.getCleanupLeaseToken(), claim.token())
                || attempt.getCleanupLeaseUntil() == null
                || !now.isBefore(attempt.getCleanupLeaseUntil())
                || attempt.getCleanupRequestedAt() == null
                || attempt.getLastCleanupAttemptAt() == null
                || now.isBefore(attempt.getLastCleanupAttemptAt())
                || now.isBefore(attempt.getCleanupRequestedAt())
                || attempt.getCleanupConfirmedAt() != null
                || !Objects.equals(attempt.getObjectKey(), claim.key().value())
                || file.getPurgedAt() != null) return CompletionDisposition.STALE;
        boolean parentFenced =
                file.getCleanupRequestedAt() != null || file.getExpiryRecordedAt() != null;
        boolean liveSelected =
                Objects.equals(file.getSelectedAttemptId(), attempt.getId())
                        && !parentFenced
                        && (file.getClaimedAt() != null || now.isBefore(file.getExpiresAt()));
        if (liveSelected) return CompletionDisposition.STALE;
        if (completion.acknowledged()
                && claim.settledAtClaim()
                && (attempt.getWriteSettledAt() == null
                        || now.isBefore(attempt.getWriteSettledAt())
                        || now.isBefore(attempt.getCleanupRequestedAt())))
            return CompletionDisposition.STALE;
        attempt.setCleanupLeaseToken(null);
        attempt.setCleanupLeaseUntil(null);
        attempt.setUpdatedAt(now);
        CompletionDisposition disposition;
        if (!completion.acknowledged()) {
            long failures =
                    attempt.getConsecutiveCleanupFailures() == Long.MAX_VALUE
                            ? Long.MAX_VALUE
                            : attempt.getConsecutiveCleanupFailures() + 1;
            attempt.setConsecutiveCleanupFailures(failures);
            attempt.setLastCleanupErrorCode(completion.error().name());
            attempt.setNextCleanupAt(
                    now.plus(
                            FileRecoveryBackoff.delay(
                                    properties.getRecovery().getInitialRetryDelay(),
                                    properties.getRecovery().getMaxRetryDelay(),
                                    failures,
                                    RETRY_JITTER::nextDouble)));
            disposition = CompletionDisposition.RETRY_SCHEDULED;
        } else {
            attempt.setConsecutiveCleanupFailures(0);
            attempt.setLastCleanupErrorCode(null);
            if (claim.settledAtClaim()) {
                attempt.setCleanupConfirmedAt(now);
                attempt.setNextCleanupAt(null);
                attempt.setObjectKey(null);
                attempt.setExpectedSizeBytes(null);
                attempt.setExpectedSha256(null);
                attempt.setVerifiedSizeBytes(null);
                attempt.setVerifiedSha256(null);
                disposition = CompletionDisposition.TERMINAL_CONFIRMED;
            } else {
                attempt.setNextCleanupAt(
                        attempt.getWriteSettledAt() != null
                                ? now
                                : now.plus(properties.getRecovery().getUnknownRevisitInterval()));
                disposition = CompletionDisposition.UNKNOWN_REVISIT;
            }
        }
        attempts.saveAndFlush(attempt);
        return disposition;
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public boolean compactFile(UUID fileId) {
        if (!recovery.lockFileIfAvailable(fileId)) return false;
        FileMetadataEntity file = files.findById(fileId).orElseThrow();
        if (file.getPurgedAt() != null
                || (file.getCleanupRequestedAt() == null && file.getExpiryRecordedAt() == null)
                || recovery.hasUnconfirmedAttempts(fileId)) return false;
        Instant now = clock.now();
        if (now.isBefore(file.getCreatedAt())
                || (file.getCleanupRequestedAt() != null
                        && now.isBefore(file.getCleanupRequestedAt()))
                || (file.getExpiryRecordedAt() != null && now.isBefore(file.getExpiryRecordedAt())))
            return false;
        file.setOriginalFilename(null);
        file.setDeclaredContentType(null);
        file.setValidatedFormat(null);
        file.setExpectedSizeBytes(null);
        file.setExpectedSha256(null);
        file.setSelectedAttemptId(null);
        file.setPurgedAt(now);
        file.setUpdatedAt(now);
        files.saveAndFlush(file);
        return true;
    }
}
