package com.krishnamurti.horizon.file.domain;

import com.krishnamurti.horizon.file.api.model.FileLifecycle;
import java.time.Instant;
import java.util.UUID;

public final class FileLifecyclePolicy {
    private FileLifecyclePolicy() {}

    public static FileLifecycle derive(
            Instant now,
            Instant expiresAt,
            UUID selectedAttemptId,
            Instant claimedAt,
            Instant cleanupRequestedAt,
            Instant purgedAt) {
        if (purgedAt != null) {
            return FileLifecycle.PURGED;
        }
        if (cleanupRequestedAt != null) {
            return FileLifecycle.CLEANUP_REQUESTED;
        }
        if (claimedAt != null) {
            return FileLifecycle.CLAIMED;
        }
        if (now.compareTo(expiresAt) >= 0) {
            return FileLifecycle.EXPIRED;
        }
        if (selectedAttemptId != null) {
            return FileLifecycle.VERIFIED;
        }
        return FileLifecycle.PREPARED;
    }
}
