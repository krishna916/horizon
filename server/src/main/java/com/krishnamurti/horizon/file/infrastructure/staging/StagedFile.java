package com.krishnamurti.horizon.file.infrastructure.staging;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.concurrent.atomic.AtomicBoolean;

public final class StagedFile implements AutoCloseable {
    private final Path path;
    private final long sizeBytes;
    private final String sha256;
    private final StagingCapacity.Reservation reservation;
    private final AtomicBoolean closed = new AtomicBoolean();

    StagedFile(Path path, long sizeBytes, String sha256, StagingCapacity.Reservation reservation) {
        this.path = path;
        this.sizeBytes = sizeBytes;
        this.sha256 = sha256;
        this.reservation = reservation;
    }

    public Path path() {
        return path;
    }

    public long sizeBytes() {
        return sizeBytes;
    }

    public String sha256() {
        return sha256;
    }

    @Override
    public void close() throws IOException {
        if (closed.compareAndSet(false, true)) {
            try {
                Files.deleteIfExists(path);
            } finally {
                reservation.close();
            }
        }
    }
}
