package com.krishnamurti.horizon.poc.s3;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.time.Instant;
import java.util.concurrent.locks.ReentrantLock;

final class ProofEvidence {

    private static final ReentrantLock LOCK = new ReentrantLock();

    private ProofEvidence() {}

    static void record(String runId, String caseId, String observation) {
        Path results =
                Path.of(System.getProperty("user.dir"), "results", "observations.md");
        String keys = S3Environment.recordedKeys(runId, caseId);
        String line = "- " + Instant.now() + " | run=" + runId + " | " + caseId
                + (keys.isBlank() ? "" : " | keys=" + keys) + " | " + observation.replace('\n', ' ').replace('\r', ' ') + System.lineSeparator();
        LOCK.lock();
        try {
            Files.createDirectories(results.getParent());
            Files.writeString(
                    results,
                    line,
                    StandardOpenOption.CREATE,
                    StandardOpenOption.WRITE,
                    StandardOpenOption.APPEND);
        } catch (IOException e) {
            throw new IllegalStateException("Could not append sanitized proof evidence", e);
        } finally {
            LOCK.unlock();
        }
    }
}
