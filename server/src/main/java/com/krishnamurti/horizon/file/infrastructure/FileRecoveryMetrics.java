package com.krishnamurti.horizon.file.infrastructure;

import com.krishnamurti.horizon.file.application.FileRecoveryTransactions.CleanupError;
import com.krishnamurti.horizon.file.application.FileRecoveryTransactions.CompletionDisposition;
import com.krishnamurti.horizon.file.infrastructure.persistence.FileRecoveryPersistence.RecoveryCounts;
import edu.umd.cs.findbugs.annotations.SuppressFBWarnings;
import io.micrometer.core.instrument.MeterRegistry;
import java.time.Duration;
import java.time.Instant;
import java.util.Locale;
import java.util.concurrent.atomic.AtomicLong;
import org.springframework.stereotype.Component;

@Component
public class FileRecoveryMetrics {
    private final MeterRegistry registry;
    private final AtomicLong pending = new AtomicLong(),
            due = new AtomicLong(),
            overdue = new AtomicLong(),
            unresolved = new AtomicLong(),
            active = new AtomicLong(),
            expired = new AtomicLong(),
            oldest = new AtomicLong(),
            lastSuccess = new AtomicLong();

    @SuppressFBWarnings(
            value = "EI_EXPOSE_REP2",
            justification = "The injected registry is a private final Spring-managed dependency.")
    public FileRecoveryMetrics(MeterRegistry registry) {
        this.registry = registry;
        registry.gauge("horizon.file.recovery.pending", pending);
        registry.gauge("horizon.file.recovery.due", due);
        registry.gauge("horizon.file.recovery.overdue", overdue);
        registry.gauge("horizon.file.recovery.unresolved", unresolved);
        registry.gauge("horizon.file.recovery.active.leases", active);
        registry.gauge("horizon.file.recovery.expired.leases", expired);
        registry.gauge("horizon.file.recovery.oldest.unresolved.age.seconds", oldest);
        registry.gauge("horizon.file.recovery.last.success.epoch.seconds", lastSuccess);
        registry.counter("horizon.file.recovery.lease.reclaims");
    }

    public void updateCounts(RecoveryCounts c) {
        pending.set(c.pending());
        due.set(c.due());
        overdue.set(c.overdue());
        unresolved.set(c.unresolved());
        active.set(c.activeLeases());
        expired.set(c.expiredLeases());
        oldest.set(c.oldestUnresolvedAgeSeconds());
    }

    public void recordCycle(Duration elapsed, boolean completed, Instant now) {
        registry.timer("horizon.file.recovery.cycle.duration").record(elapsed);
        if (completed) lastSuccess.set(now.getEpochSecond());
    }

    public void recordDelete(CompletionDisposition disposition) {
        registry.counter(
                        "horizon.file.recovery.delete.outcomes",
                        "outcome",
                        disposition.name().toLowerCase(Locale.ROOT))
                .increment();
    }

    public void recordError(CleanupError error) {
        registry.counter(
                        "horizon.file.recovery.errors",
                        "error",
                        error.name().toLowerCase(Locale.ROOT))
                .increment();
    }

    public void recordLeaseReclaim() {
        registry.counter("horizon.file.recovery.lease.reclaims").increment();
    }
}
