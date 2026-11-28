package com.krishnamurti.horizon.file.application;

import com.krishnamurti.horizon.file.application.port.ObjectStorage;
import com.krishnamurti.horizon.file.application.port.ObjectStorageException;
import com.krishnamurti.horizon.file.infrastructure.FileProperties;
import com.krishnamurti.horizon.file.infrastructure.FileRecoveryMetrics;
import com.krishnamurti.horizon.file.infrastructure.persistence.FileRecoveryPersistence;
import com.krishnamurti.horizon.file.infrastructure.persistence.FileRecoveryPersistence.Candidate;
import com.krishnamurti.horizon.file.infrastructure.persistence.FileRecoveryPersistence.WorkKind;
import edu.umd.cs.findbugs.annotations.SuppressFBWarnings;
import java.util.ArrayDeque;
import java.util.EnumMap;
import java.util.HashSet;
import java.util.Set;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.Supplier;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

@Component
public class FileRecoveryWorker {
    private static final Logger log = LoggerFactory.getLogger(FileRecoveryWorker.class);
    private final FileRecoveryPersistence persistence;
    private final FileRecoveryTransactions transactions;
    private final ObjectStorage storage;
    private final RecoveryClock clock;
    private final FileProperties properties;
    private final FileRecoveryMetrics metrics;
    private final AtomicBoolean running = new AtomicBoolean();
    private final AtomicInteger start = new AtomicInteger();
    private final Object admissionGate = new Object();
    private boolean acceptingWork = true;

    @SuppressFBWarnings(
            value = "EI_EXPOSE_REP2",
            justification =
                    "The injected collaborators are private final Spring-managed dependencies.")
    public FileRecoveryWorker(
            FileRecoveryPersistence persistence,
            FileRecoveryTransactions transactions,
            ObjectStorage storage,
            RecoveryClock clock,
            FileProperties properties,
            FileRecoveryMetrics metrics) {
        this.persistence = persistence;
        this.transactions = transactions;
        this.storage = storage;
        this.clock = clock;
        this.properties = properties;
        this.metrics = metrics;
    }

    @Transactional(propagation = Propagation.NEVER)
    public void runCycle() {
        synchronized (admissionGate) {
            if (!acceptingWork || !running.compareAndSet(false, true)) return;
        }
        long started = System.nanoTime();
        boolean completed = false;
        java.time.Instant completedAt = java.time.Instant.EPOCH;
        try {
            int batch = properties.getRecovery().getBatchSize();
            var now = clock.now();
            var queues = new EnumMap<WorkKind, ArrayDeque<Candidate>>(WorkKind.class);
            for (WorkKind kind : WorkKind.values()) {
                var candidates = admit(() -> persistence.findCandidates(kind, now, batch));
                if (candidates == null) break;
                queues.put(kind, new ArrayDeque<>(candidates));
            }
            WorkKind[] kinds = WorkKind.values();
            int index =
                    Math.floorMod(start.getAndUpdate(n -> (n + 1) % kinds.length), kinds.length);
            Set<Candidate> seen = new HashSet<>();
            int examined = 0, empty = 0;
            while (examined < batch
                    && empty < kinds.length
                    && isAcceptingWork()
                    && !Thread.currentThread().isInterrupted()) {
                var queue = queues.get(kinds[index]);
                index = (index + 1) % kinds.length;
                Candidate candidate = queue.pollFirst();
                if (candidate == null) {
                    empty++;
                    continue;
                }
                empty = 0;
                if (!seen.add(candidate)) continue;
                examined++;
                process(candidate);
            }
            if (!Thread.currentThread().isInterrupted() && isAcceptingWork()) {
                completedAt = clock.now();
                var counts = persistence.recoveryCounts(completedAt);
                completed = true;
                safeMetric(() -> metrics.updateCounts(counts));
            }
        } catch (RuntimeException exception) {
            log.warn("File recovery cycle failed: DB_RETRY");
            safeMetric(() -> metrics.recordError(FileRecoveryTransactions.CleanupError.DB_RETRY));
        } finally {
            var elapsed = java.time.Duration.ofNanos(System.nanoTime() - started);
            boolean success = completed;
            java.time.Instant finished = completedAt;
            safeMetric(() -> metrics.recordCycle(elapsed, success, finished));
            running.set(false);
        }
    }

    private void process(Candidate candidate) {
        switch (candidate.kind()) {
            case EXPIRE_FILE -> admit(() -> transactions.recordExpiry(candidate.fileId()));
            case COMPACT_FILE -> admit(() -> transactions.compactFile(candidate.fileId()));
            case DELETE_ATTEMPT -> {
                var claim =
                        admit(
                                () ->
                                        transactions.claimDelete(
                                                candidate.fileId(), candidate.attemptId()));
                if (claim == null || claim.isEmpty()) return;
                if (claim.get().reclaimedLease()) safeMetric(metrics::recordLeaseReclaim);
                FileRecoveryTransactions.DeleteCompletion completion;
                try {
                    storage.delete(claim.get().key());
                    completion = FileRecoveryTransactions.DeleteCompletion.ack();
                } catch (ObjectStorageException exception) {
                    completion =
                            FileRecoveryTransactions.DeleteCompletion.failed(
                                    FileRecoveryTransactions.CleanupError.STORAGE_UNAVAILABLE);
                } catch (RuntimeException exception) {
                    completion =
                            FileRecoveryTransactions.DeleteCompletion.failed(
                                    FileRecoveryTransactions.CleanupError.DELETE_FAILED);
                }
                if (Thread.currentThread().isInterrupted()) return;
                var disposition = transactions.completeDelete(claim.get(), completion);
                safeMetric(() -> metrics.recordDelete(disposition));
                if (!completion.acknowledged()) {
                    var error = completion.error();
                    safeMetric(() -> metrics.recordError(error));
                }
            }
        }
    }

    /** Prevents this worker from admitting another database or provider operation. */
    public void stopAcceptingWork() {
        synchronized (admissionGate) {
            acceptingWork = false;
        }
    }

    boolean isAcceptingWork() {
        synchronized (admissionGate) {
            return acceptingWork;
        }
    }

    private <T> T admit(Supplier<T> operation) {
        synchronized (admissionGate) {
            if (!acceptingWork) return null;
            return operation.get();
        }
    }

    private static void safeMetric(Runnable update) {
        try {
            update.run();
        } catch (RuntimeException ignored) {
            log.warn("File recovery metrics update failed");
        }
    }
}
