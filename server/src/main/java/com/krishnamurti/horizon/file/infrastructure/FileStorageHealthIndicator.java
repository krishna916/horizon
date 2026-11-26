package com.krishnamurti.horizon.file.infrastructure;

import com.krishnamurti.horizon.file.application.port.ObjectStorage;
import edu.umd.cs.findbugs.annotations.SuppressFBWarnings;
import org.springframework.boot.health.contributor.Health;
import org.springframework.boot.health.contributor.HealthIndicator;
import org.springframework.stereotype.Component;

/** Reports private object-storage readiness without changing application liveness. */
@Component("fileStorageHealthIndicator")
@SuppressFBWarnings(
        value = "EI_EXPOSE_REP2",
        justification =
                "The storage port and metrics are private, final Spring-managed collaborators.")
public final class FileStorageHealthIndicator implements HealthIndicator {
    private final ObjectStorage storage;
    private final FileMetrics metrics;

    public FileStorageHealthIndicator(ObjectStorage storage, FileMetrics metrics) {
        this.storage = storage;
        this.metrics = metrics;
    }

    @Override
    public Health health() {
        try {
            storage.checkAvailability();
            return Health.up().build();
        } catch (RuntimeException failure) {
            metrics.storageError("health");
            return Health.down().withDetail("storage", "unavailable").build();
        }
    }
}
