package com.krishnamurti.horizon.file.infrastructure.staging;

import com.krishnamurti.horizon.file.infrastructure.FileProperties;
import edu.umd.cs.findbugs.annotations.SuppressFBWarnings;
import java.util.concurrent.Semaphore;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicLong;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

@Component
@SuppressFBWarnings(
        value = "CT_CONSTRUCTOR_THROW",
        justification =
                "Invalid staging capacities must fail fast before a limiter instance is published.")
public class StagingCapacity {
    private final Semaphore slots;
    private final int maximumSlots;
    private static final long MAX_SCRATCH_BYTES_PER_VALIDATION = 128L * 1024 * 1024;
    private final AtomicLong reservedBytes = new AtomicLong();
    private final AtomicLong reservedScratchBytes = new AtomicLong();
    private final long maximumBytes;
    private final long maximumScratchBytes;

    @Autowired
    public StagingCapacity(FileProperties properties) {
        this(
                properties.getStaging().getMaxConcurrentTransfers(),
                properties
                        .getStaging()
                        .effectiveMaxTotalSizeBytes(properties.getMaxFileSizeBytes()));
    }

    StagingCapacity(int maximumSlots, long maximumBytes) {
        if (maximumSlots <= 0 || maximumBytes <= 0) {
            throw new IllegalArgumentException("Staging capacity must be positive");
        }
        this.maximumSlots = maximumSlots;
        this.slots = new Semaphore(maximumSlots, true);
        this.maximumBytes = maximumBytes;
        this.maximumScratchBytes =
                Math.multiplyExact(maximumSlots, MAX_SCRATCH_BYTES_PER_VALIDATION);
    }

    public Reservation reserve(long bytes) {
        if (bytes <= 0 || bytes > maximumBytes || !slots.tryAcquire()) {
            throw new StagingCapacityException();
        }
        while (true) {
            long current = reservedBytes.get();
            long next;
            try {
                next = Math.addExact(current, bytes);
            } catch (ArithmeticException exception) {
                slots.release();
                throw new StagingCapacityException();
            }
            if (next > maximumBytes) {
                slots.release();
                throw new StagingCapacityException();
            }
            if (reservedBytes.compareAndSet(current, next)) {
                return new Reservation(bytes);
            }
        }
    }

    public int activeSlots() {
        return maximumSlots - slots.availablePermits();
    }

    public long reservedBytes() {
        return reservedBytes.get();
    }

    public ScratchReservation reserveScratch(long bytes) {
        if (bytes <= 0 || bytes > MAX_SCRATCH_BYTES_PER_VALIDATION) {
            return null;
        }
        while (true) {
            long current = reservedScratchBytes.get();
            long next;
            try {
                next = Math.addExact(current, bytes);
            } catch (ArithmeticException exception) {
                return null;
            }
            if (next > maximumScratchBytes) {
                return null;
            }
            if (reservedScratchBytes.compareAndSet(current, next)) {
                return new ScratchReservation(bytes);
            }
        }
    }

    public long reservedScratchBytes() {
        return reservedScratchBytes.get();
    }

    public final class ScratchReservation implements AutoCloseable {
        private final long bytes;
        private final AtomicBoolean released = new AtomicBoolean();

        private ScratchReservation(long bytes) {
            this.bytes = bytes;
        }

        @Override
        public void close() {
            if (released.compareAndSet(false, true)) {
                reservedScratchBytes.addAndGet(-bytes);
            }
        }
    }

    public final class Reservation implements AutoCloseable {
        private final long bytes;
        private final AtomicBoolean released = new AtomicBoolean();

        private Reservation(long bytes) {
            this.bytes = bytes;
        }

        @Override
        public void close() {
            if (released.compareAndSet(false, true)) {
                reservedBytes.addAndGet(-bytes);
                slots.release();
            }
        }
    }
}
