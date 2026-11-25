package com.krishnamurti.horizon.file.infrastructure.staging;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.krishnamurti.horizon.file.api.model.FileDescriptor;
import com.krishnamurti.horizon.file.infrastructure.FileProperties;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.util.unit.DataSize;

class FileStagingServiceTest {
    private static final byte[] CONTENT =
            "bounded file bytes".getBytes(java.nio.charset.StandardCharsets.UTF_8);

    @TempDir Path temporaryDirectory;

    @Test
    void exactLengthAndDigestStagedAndCleanedOnClose() throws Exception {
        FileProperties properties = properties(temporaryDirectory.resolve("stage"), 1_000, 4);
        try (StagingDirectory directory =
                new StagingDirectory(Path.of(properties.getStaging().getDirectory()))) {
            FileStagingService service =
                    new FileStagingService(properties, new StagingCapacity(properties), directory);
            FileDescriptor descriptor = descriptor(CONTENT, "sample.txt");
            StagedFile staged =
                    service.stage(new ByteArrayInputStream(CONTENT), CONTENT.length, descriptor);
            Path path = staged.path();
            assertThat(staged.sizeBytes()).isEqualTo(CONTENT.length);
            assertThat(staged.sha256()).isEqualTo(descriptor.expectedSha256());
            assertThat(Files.readAllBytes(path)).containsExactly(CONTENT);
            staged.close();
            assertThat(Files.exists(path)).isFalse();
        }
    }

    @Test
    void lengthMismatchAndChecksumMismatchCleanUp() throws Exception {
        FileProperties properties = properties(temporaryDirectory.resolve("stage"), 100, 4);
        try (StagingDirectory directory =
                new StagingDirectory(Path.of(properties.getStaging().getDirectory()))) {
            StagingCapacity capacity = new StagingCapacity(properties);
            FileStagingService service = new FileStagingService(properties, capacity, directory);
            FileDescriptor descriptor = descriptor(CONTENT, "sample.txt");
            FileDescriptor shortDescriptor =
                    new FileDescriptor(
                            "sample.txt", "text/plain", CONTENT.length + 1L, "b".repeat(64));
            assertThatThrownBy(
                            () ->
                                    service.stage(
                                            new ByteArrayInputStream(CONTENT),
                                            CONTENT.length + 1L,
                                            shortDescriptor))
                    .isInstanceOf(IOException.class);
            byte[] overlong = java.util.Arrays.copyOf(CONTENT, CONTENT.length + 1);
            assertThatThrownBy(
                            () ->
                                    service.stage(
                                            new ByteArrayInputStream(overlong),
                                            CONTENT.length,
                                            descriptor))
                    .isInstanceOf(IOException.class);
            assertThatThrownBy(
                            () ->
                                    service.stage(
                                            new ByteArrayInputStream(CONTENT),
                                            CONTENT.length,
                                            new FileDescriptor(
                                                    "sample.txt",
                                                    "text/plain",
                                                    CONTENT.length,
                                                    "b".repeat(64))))
                    .isInstanceOf(IOException.class);
            assertThat(stageFiles(directory.path())).isEmpty();
            assertThat(capacity.activeSlots()).isZero();
            assertThat(capacity.reservedBytes()).isZero();
        }
    }

    @Test
    void defaultBoundaryAndConfiguredCeiling() throws Exception {
        FileProperties defaults =
                properties(
                        temporaryDirectory.resolve("default"),
                        FileProperties.DEFAULT_MAX_FILE_SIZE_BYTES,
                        4);
        try (StagingDirectory directory =
                new StagingDirectory(Path.of(defaults.getStaging().getDirectory()))) {
            FileStagingService service =
                    new FileStagingService(defaults, new StagingCapacity(defaults), directory);
            long defaultLimit = FileProperties.DEFAULT_MAX_FILE_SIZE_BYTES;
            try (StagedFile ignored =
                    service.stage(
                            zeroes(defaultLimit), defaultLimit, zeroDescriptor(defaultLimit))) {
                assertThat(ignored.sizeBytes()).isEqualTo(defaultLimit);
            }
            AtomicInteger reads = new AtomicInteger();
            InputStream unread =
                    new InputStream() {
                        @Override
                        public int read() {
                            reads.incrementAndGet();
                            return -1;
                        }

                        @Override
                        public int read(byte[] bytes, int offset, int length) {
                            reads.incrementAndGet();
                            return -1;
                        }
                    };
            assertThatThrownBy(
                            () ->
                                    service.stage(
                                            unread,
                                            defaultLimit + 1,
                                            zeroDescriptor(defaultLimit + 1)))
                    .isInstanceOf(IllegalArgumentException.class);
            assertThat(reads).hasValue(0);
        }

        long ceiling = FileProperties.HARD_MAX_FILE_SIZE_BYTES;
        FileProperties maximum = properties(temporaryDirectory.resolve("maximum"), ceiling, 4);
        try (StagingDirectory directory =
                new StagingDirectory(Path.of(maximum.getStaging().getDirectory()))) {
            FileStagingService service =
                    new FileStagingService(maximum, new StagingCapacity(maximum), directory);
            try (StagedFile ignored =
                    service.stage(zeroes(ceiling), ceiling, zeroDescriptor(ceiling))) {
                assertThat(ignored.sizeBytes()).isEqualTo(ceiling);
            }
            assertThatThrownBy(
                            () ->
                                    service.stage(
                                            zeroes(ceiling + 1),
                                            ceiling + 1,
                                            zeroDescriptor(ceiling + 1)))
                    .isInstanceOf(IllegalArgumentException.class);
        }
    }

    @Test
    void unknownOrNonpositiveLengthRejectedBeforeRead() throws Exception {
        FileProperties properties = properties(temporaryDirectory.resolve("stage"), 100, 4);
        try (StagingDirectory directory =
                new StagingDirectory(Path.of(properties.getStaging().getDirectory()))) {
            FileStagingService service =
                    new FileStagingService(properties, new StagingCapacity(properties), directory);
            AtomicInteger reads = new AtomicInteger();
            InputStream unread =
                    new InputStream() {
                        @Override
                        public int read() {
                            reads.incrementAndGet();
                            return -1;
                        }

                        @Override
                        public int read(byte[] bytes, int offset, int length) {
                            reads.incrementAndGet();
                            return -1;
                        }
                    };
            FileDescriptor descriptor = descriptor(CONTENT, "sample.txt");
            assertThatThrownBy(() -> service.stage(unread, -1, descriptor))
                    .isInstanceOf(IllegalArgumentException.class);
            assertThatThrownBy(() -> service.stage(unread, 0, descriptor))
                    .isInstanceOf(IllegalArgumentException.class);
            assertThat(reads).hasValue(0);
        }
    }

    @Test
    void capacityExhaustedIsRetryableAndCapacityReleasedOnClose() throws Exception {
        FileProperties properties = properties(temporaryDirectory.resolve("stage"), 100, 4);
        try (StagingDirectory directory =
                new StagingDirectory(Path.of(properties.getStaging().getDirectory()))) {
            StagingCapacity capacity = new StagingCapacity(properties);
            FileStagingService service = new FileStagingService(properties, capacity, directory);
            FileDescriptor descriptor = descriptor(CONTENT, "sample.txt");
            StagedFile[] staged = new StagedFile[4];
            for (int i = 0; i < staged.length; i++) {
                staged[i] =
                        service.stage(
                                new ByteArrayInputStream(CONTENT), CONTENT.length, descriptor);
            }
            assertThatThrownBy(
                            () ->
                                    service.stage(
                                            new ByteArrayInputStream(CONTENT),
                                            CONTENT.length,
                                            descriptor))
                    .isInstanceOf(StagingCapacityException.class);
            for (StagedFile file : staged) file.close();
            try (StagedFile retry =
                    service.stage(new ByteArrayInputStream(CONTENT), CONTENT.length, descriptor)) {
                assertThat(retry.sizeBytes()).isEqualTo(CONTENT.length);
            }
        }
    }

    @Test
    void validationScratchAccountingIsSeparateFromPayloadAccounting() {
        FileProperties properties = properties(temporaryDirectory.resolve("stage"), 100, 4);
        StagingCapacity capacity = new StagingCapacity(properties);
        long scratchLimit = 128L * 1024 * 1024;

        try (StagingCapacity.ScratchReservation ignored = capacity.reserveScratch(scratchLimit)) {
            assertThat(capacity.activeSlots()).isZero();
            assertThat(capacity.reservedBytes()).isZero();
            assertThat(capacity.reservedScratchBytes()).isEqualTo(scratchLimit);
        }

        assertThat(capacity.reservedScratchBytes()).isZero();
        assertThat(capacity.reserveScratch(scratchLimit + 1)).isNull();
    }

    @Test
    void writeFailureReleasesReservationAndDeletesPartialFile() throws Exception {
        FileProperties properties = properties(temporaryDirectory.resolve("stage"), 100, 4);
        try (StagingDirectory directory =
                new StagingDirectory(Path.of(properties.getStaging().getDirectory()))) {
            StagingCapacity capacity = new StagingCapacity(properties);
            FileStagingService service =
                    new FileStagingService(
                            properties,
                            capacity,
                            directory,
                            path ->
                                    new OutputStream() {
                                        @Override
                                        public void write(int value) throws IOException {
                                            throw new IOException("injected write failure");
                                        }

                                        @Override
                                        public void write(byte[] bytes, int offset, int length)
                                                throws IOException {
                                            throw new IOException("injected write failure");
                                        }
                                    });
            FileDescriptor descriptor = descriptor(CONTENT, "sample.txt");
            assertThatThrownBy(
                            () ->
                                    service.stage(
                                            new ByteArrayInputStream(CONTENT),
                                            CONTENT.length,
                                            descriptor))
                    .isInstanceOf(IOException.class);
            assertThat(stageFiles(directory.path())).isEmpty();
            assertThat(capacity.activeSlots()).isZero();
            assertThat(capacity.reservedBytes()).isZero();
        }
    }

    @Test
    void callerOwnsStream() throws Exception {
        FileProperties properties = properties(temporaryDirectory.resolve("stage"), 100, 4);
        try (StagingDirectory directory =
                new StagingDirectory(Path.of(properties.getStaging().getDirectory()))) {
            FileStagingService service =
                    new FileStagingService(properties, new StagingCapacity(properties), directory);
            AtomicInteger closes = new AtomicInteger();
            InputStream input =
                    new ByteArrayInputStream(CONTENT) {
                        @Override
                        public void close() throws IOException {
                            closes.incrementAndGet();
                            super.close();
                        }
                    };
            try (StagedFile ignored =
                    service.stage(input, CONTENT.length, descriptor(CONTENT, "sample.txt"))) {
                assertThat(closes).hasValue(0);
            }
            assertThat(closes).hasValue(0);
        }
    }

    private static FileProperties properties(Path directory, long maximum, int slots) {
        FileProperties properties = new FileProperties();
        properties.setMaxFileSize(DataSize.ofBytes(maximum));
        properties.getStaging().setDirectory(directory.toString());
        properties.getStaging().setMaxConcurrentTransfers(slots);
        properties
                .getStaging()
                .setMaxTotalSize(DataSize.ofBytes(Math.multiplyExact(maximum, slots)));
        properties.validate();
        return properties;
    }

    private static FileDescriptor descriptor(byte[] bytes, String filename) {
        return new FileDescriptor(filename, "text/plain", bytes.length, digest(bytes));
    }

    private static FileDescriptor zeroDescriptor(long size) {
        return new FileDescriptor("zeros.bin", "application/octet-stream", size, zeroDigest(size));
    }

    private static InputStream zeroes(long size) {
        return new InputStream() {
            private long remaining = size;

            @Override
            public int read() {
                if (remaining == 0) return -1;
                remaining--;
                return 0;
            }

            @Override
            public int read(byte[] buffer, int offset, int length) {
                if (remaining == 0) return -1;
                int count = (int) Math.min(remaining, length);
                java.util.Arrays.fill(buffer, offset, offset + count, (byte) 0);
                remaining -= count;
                return count;
            }
        };
    }

    private static String zeroDigest(long size) {
        MessageDigest digest;
        try {
            digest = MessageDigest.getInstance("SHA-256");
        } catch (java.security.NoSuchAlgorithmException exception) {
            throw new IllegalStateException(exception);
        }
        byte[] zeros = new byte[65_536];
        while (size > 0) {
            int count = (int) Math.min(size, zeros.length);
            digest.update(zeros, 0, count);
            size -= count;
        }
        return HexFormat.of().formatHex(digest.digest());
    }

    private static String digest(byte[] value) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value));
        } catch (java.security.NoSuchAlgorithmException exception) {
            throw new IllegalStateException(exception);
        }
    }

    private static java.util.List<Path> stageFiles(Path directory) throws IOException {
        try (var files = Files.list(directory)) {
            return files.filter(path -> path.getFileName().toString().startsWith("horizon-file-"))
                    .toList();
        }
    }
}
