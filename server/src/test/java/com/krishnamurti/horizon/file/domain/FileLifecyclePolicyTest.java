package com.krishnamurti.horizon.file.domain;

import static org.assertj.core.api.Assertions.assertThat;

import com.krishnamurti.horizon.file.api.model.FileLifecycle;
import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class FileLifecyclePolicyTest {
    private static final Instant NOW = Instant.parse("2026-01-01T00:00:00Z");

    @Test
    void expiryBoundaryAndClaimPriority() {
        assertThat(FileLifecyclePolicy.derive(NOW, NOW, UUID.randomUUID(), null, null, null))
                .isEqualTo(FileLifecycle.EXPIRED);
        assertThat(FileLifecyclePolicy.derive(NOW, NOW, UUID.randomUUID(), NOW, null, null))
                .isEqualTo(FileLifecycle.CLAIMED);
    }

    @Test
    void cleanupAndPurgeTakePrecedence() {
        assertThat(FileLifecyclePolicy.derive(NOW, NOW, null, null, NOW, null))
                .isEqualTo(FileLifecycle.CLEANUP_REQUESTED);
        assertThat(FileLifecyclePolicy.derive(NOW, NOW, null, null, NOW, NOW))
                .isEqualTo(FileLifecycle.PURGED);
    }
}
