package com.krishnamurti.horizon.file.application;

import com.krishnamurti.horizon.file.application.port.ObjectStorage;
import com.krishnamurti.horizon.file.application.port.ObjectStorageException;
import com.krishnamurti.horizon.file.infrastructure.FileProperties;
import com.krishnamurti.horizon.file.infrastructure.persistence.FileRecoveryPersistence;
import com.krishnamurti.horizon.file.infrastructure.persistence.FileRecoveryPersistence.Candidate;
import com.krishnamurti.horizon.file.infrastructure.persistence.FileRecoveryPersistence.WorkKind;
import java.util.ArrayDeque;
import java.util.EnumMap;
import java.util.HashSet;
import java.util.Set;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
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
    private final AtomicBoolean running = new AtomicBoolean();
    private final AtomicInteger start = new AtomicInteger();

    public FileRecoveryWorker(
            FileRecoveryPersistence persistence,
            FileRecoveryTransactions transactions,
            ObjectStorage storage,
            RecoveryClock clock,
            FileProperties properties) {
        this.persistence = persistence;
        this.transactions = transactions;
        this.storage = storage;
        this.clock = clock;
        this.properties = properties;
    }

    @Transactional(propagation = Propagation.NEVER)
    public void runCycle() {
        if (!running.compareAndSet(false, true)) return;
        try {
            int batch = properties.getRecovery().getBatchSize();
            var now = clock.now();
            var queues = new EnumMap<WorkKind, ArrayDeque<Candidate>>(WorkKind.class);
            for (WorkKind kind : WorkKind.values())
                queues.put(kind, new ArrayDeque<>(persistence.findCandidates(kind, now, batch)));
            WorkKind[] kinds = WorkKind.values();
            int index =
                    Math.floorMod(start.getAndUpdate(n -> (n + 1) % kinds.length), kinds.length);
            Set<Candidate> seen = new HashSet<>();
            int examined = 0, empty = 0;
            while (examined < batch
                    && empty < kinds.length
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
        } catch (RuntimeException exception) {
            log.warn("File recovery cycle failed: DB_RETRY");
        } finally {
            running.set(false);
        }
    }

    private void process(Candidate candidate) {
        switch (candidate.kind()) {
            case EXPIRE_FILE -> transactions.recordExpiry(candidate.fileId());
            case COMPACT_FILE -> transactions.compactFile(candidate.fileId());
            case DELETE_ATTEMPT -> {
                var claim = transactions.claimDelete(candidate.fileId(), candidate.attemptId());
                if (claim.isEmpty()) return;
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
                transactions.completeDelete(claim.get(), completion);
            }
        }
    }
}
