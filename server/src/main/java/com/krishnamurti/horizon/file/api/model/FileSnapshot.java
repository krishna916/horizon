package com.krishnamurti.horizon.file.api.model;

import java.time.Instant;
import java.util.UUID;

public record FileSnapshot(
        UUID fileId,
        FileLifecycle lifecycle,
        FileMetadata metadata,
        Instant createdAt,
        Instant expiresAt,
        Instant claimedAt,
        Instant cleanupRequestedAt) {}
