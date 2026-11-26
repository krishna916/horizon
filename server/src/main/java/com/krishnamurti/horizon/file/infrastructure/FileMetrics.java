package com.krishnamurti.horizon.file.infrastructure;

import com.krishnamurti.horizon.file.api.model.TransferDisposition;
import com.krishnamurti.horizon.file.api.model.TransferResult;
import com.krishnamurti.horizon.file.infrastructure.staging.StagingCapacity;
import edu.umd.cs.findbugs.annotations.SuppressFBWarnings;
import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.Timer;
import java.util.Locale;
import java.util.concurrent.TimeUnit;
import java.util.function.Supplier;
import org.springframework.stereotype.Component;

/** Low-cardinality operational metrics for the File module. */
@Component
@SuppressFBWarnings(
        value = "EI_EXPOSE_REP2",
        justification =
                "The meter registry and staging capacity are private Spring-managed collaborators.")
public final class FileMetrics {
    private static final String TRANSFER_OUTCOMES = "horizon.file.transfer.outcomes";
    private static final String TRANSFER_DURATION = "horizon.file.transfer.duration";
    private final MeterRegistry registry;

    public FileMetrics(MeterRegistry registry, StagingCapacity capacity) {
        this.registry = registry;
        registry.gauge("horizon.file.staging.active", capacity, StagingCapacity::activeSlots);
        registry.gauge("horizon.file.staging.bytes", capacity, StagingCapacity::reservedBytes);
    }

    public TransferResult observeTransfer(Supplier<TransferResult> transfer) {
        long started = System.nanoTime();
        String outcome = "error";
        try {
            TransferResult result = transfer.get();
            outcome = tag(result.disposition().name());
            return result;
        } finally {
            Counter.builder(TRANSFER_OUTCOMES)
                    .tag("outcome", outcome)
                    .register(registry)
                    .increment();
            Timer.builder(TRANSFER_DURATION)
                    .tag("outcome", outcome)
                    .register(registry)
                    .record(System.nanoTime() - started, TimeUnit.NANOSECONDS);
        }
    }

    public void validationRejected() {
        registry.counter("horizon.file.validation.rejections").increment();
    }

    public void storageError(String operation) {
        Counter.builder("horizon.file.storage.errors")
                .tag("operation", safeOperation(operation))
                .register(registry)
                .increment();
    }

    private static String safeOperation(String operation) {
        return switch (operation) {
            case "put", "get", "head", "delete", "health" -> operation;
            default -> "other";
        };
    }

    private static String tag(String outcome) {
        try {
            return TransferDisposition.valueOf(outcome).name().toLowerCase(Locale.ROOT);
        } catch (IllegalArgumentException exception) {
            return "other";
        }
    }
}
