package com.krishnamurti.horizon.file.infrastructure;

import static org.assertj.core.api.Assertions.assertThat;

import com.krishnamurti.horizon.file.api.model.FileFormat;
import com.krishnamurti.horizon.file.api.model.FileLifecycle;
import com.krishnamurti.horizon.file.api.model.FileMetadata;
import com.krishnamurti.horizon.file.api.model.FileSnapshot;
import com.krishnamurti.horizon.file.api.model.TransferDisposition;
import com.krishnamurti.horizon.file.api.model.TransferResult;
import com.krishnamurti.horizon.file.application.RecordingObjectStorage;
import com.krishnamurti.horizon.file.infrastructure.staging.StagingCapacity;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class FileObservabilityTest {
    @Test
    void metricsUseBoundedTagsAndNoSensitiveValues() {
        var registry = new SimpleMeterRegistry();
        var capacity = new StagingCapacity(new FileProperties());
        var metrics = new FileMetrics(registry, capacity);

        metrics.storageError("customer-secret-object-key");
        metrics.validationRejected();

        assertThat(registry.get("horizon.file.storage.errors").tag("operation", "other").counter())
                .isNotNull();
        assertThat(registry.get("horizon.file.validation.rejections").counter().count())
                .isEqualTo(1);
        assertThat(registry.getMeters())
                .allSatisfy(
                        meter ->
                                meter.getId().getTags().stream()
                                        .forEach(
                                                tag ->
                                                        assertThat(tag.getValue())
                                                                .doesNotContain(
                                                                        "secret", "customer")));
    }

    @Test
    void stagingGaugesReleaseAfterFailure() {
        var registry = new SimpleMeterRegistry();
        var capacity = new StagingCapacity(new FileProperties());
        new FileMetrics(registry, capacity);
        var reservation = capacity.reserve(37);

        assertThat(registry.get("horizon.file.staging.active").gauge().value()).isEqualTo(1);
        assertThat(registry.get("horizon.file.staging.bytes").gauge().value()).isEqualTo(37);
        try {
            throw new IllegalStateException("simulated transfer failure");
        } catch (IllegalStateException expected) {
            reservation.close();
        }

        assertThat(registry.get("horizon.file.staging.active").gauge().value()).isZero();
        assertThat(registry.get("horizon.file.staging.bytes").gauge().value()).isZero();
    }

    @Test
    void transferOutcomeMetricsDifferentiateUnknown() {
        var registry = new SimpleMeterRegistry();
        var metrics = new FileMetrics(registry, new StagingCapacity(new FileProperties()));
        var snapshot =
                new FileSnapshot(
                        UUID.randomUUID(),
                        FileLifecycle.PREPARED,
                        new FileMetadata("x.txt", "text/plain", FileFormat.TXT, 1, "a".repeat(64)),
                        Instant.now(),
                        Instant.now().plusSeconds(60),
                        null,
                        null);

        metrics.observeTransfer(
                () -> new TransferResult(TransferDisposition.OUTCOME_UNKNOWN, snapshot));

        assertThat(
                        registry.get("horizon.file.transfer.outcomes")
                                .tag("outcome", "outcome_unknown")
                                .counter()
                                .count())
                .isEqualTo(1);
        assertThat(
                        registry.get("horizon.file.transfer.duration")
                                .tag("outcome", "outcome_unknown")
                                .timer()
                                .count())
                .isEqualTo(1);
    }

    @Test
    void storageOutageReportsHealthDownWithoutAWrite() {
        var registry = new SimpleMeterRegistry();
        var metrics = new FileMetrics(registry, new StagingCapacity(new FileProperties()));
        var storage = new RecordingObjectStorage();
        var health = new FileStorageHealthIndicator(storage, metrics);

        assertThat(health.health().getStatus().getCode()).isEqualTo("UP");
        storage.setUnavailable(true);
        var down = health.health();
        assertThat(down.getStatus().getCode()).isEqualTo("DOWN");
        assertThat(down.getDetails()).containsEntry("storage", "unavailable");
        assertThat(storage.putCount()).isZero();
        assertThat(
                        registry.get("horizon.file.storage.errors")
                                .tag("operation", "health")
                                .counter()
                                .count())
                .isEqualTo(1);
    }
}
