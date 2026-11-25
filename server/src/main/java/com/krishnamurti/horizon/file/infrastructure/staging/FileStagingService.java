package com.krishnamurti.horizon.file.infrastructure.staging;

import com.krishnamurti.horizon.file.api.model.FileDescriptor;
import com.krishnamurti.horizon.file.infrastructure.FileProperties;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

@Component
public class FileStagingService {
    private final FileProperties properties;
    private final StagingCapacity capacity;
    private final StagingDirectory directory;
    private final OutputStreamFactory outputStreamFactory;

    @Autowired
    public FileStagingService(
            FileProperties properties, StagingCapacity capacity, StagingDirectory directory) {
        this(properties, capacity, directory, Files::newOutputStream);
    }

    FileStagingService(
            FileProperties properties,
            StagingCapacity capacity,
            StagingDirectory directory,
            OutputStreamFactory outputStreamFactory) {
        this.properties = properties;
        this.capacity = capacity;
        this.directory = directory;
        this.outputStreamFactory = outputStreamFactory;
    }

    public StagedFile stage(InputStream input, long declaredLength, FileDescriptor expected)
            throws IOException {
        if (declaredLength <= 0) {
            throw new IllegalArgumentException("File content length must be known and positive");
        }
        if (expected.expectedSize() != declaredLength) {
            throw new IllegalArgumentException(
                    "File content length does not match the prepared descriptor");
        }
        if (declaredLength > properties.getMaxFileSizeBytes()) {
            throw new IllegalArgumentException("File exceeds the effective upload limit");
        }

        StagingCapacity.Reservation reservation = capacity.reserve(declaredLength);
        Path stagedPath = null;
        try {
            if (Files.getFileStore(directory.path()).getUsableSpace() < declaredLength) {
                throw new IOException("Insufficient free space for staged file content");
            }
            stagedPath = directory.createTempFile();
            MessageDigest digest = sha256();
            long actualBytes = copyAndDigest(input, stagedPath, declaredLength, digest);
            String sha256 = HexFormat.of().formatHex(digest.digest());
            if (actualBytes != declaredLength) {
                throw new IOException("File content length does not match the declared length");
            }
            if (!sha256.equals(expected.expectedSha256())) {
                throw new IOException(
                        "File content checksum does not match the prepared descriptor");
            }
            return new StagedFile(stagedPath, actualBytes, sha256, reservation);
        } catch (IOException | RuntimeException | Error exception) {
            if (stagedPath != null) {
                try {
                    Files.deleteIfExists(stagedPath);
                } catch (IOException cleanupException) {
                    exception.addSuppressed(cleanupException);
                }
            }
            reservation.close();
            throw exception;
        }
    }

    private long copyAndDigest(
            InputStream input, Path stagedPath, long expectedLength, MessageDigest digest)
            throws IOException {
        byte[] buffer = new byte[properties.getStaging().getCopyBufferSize()];
        long copied = 0;
        try (OutputStream output = outputStreamFactory.open(stagedPath)) {
            while (copied < expectedLength) {
                int requested = (int) Math.min(buffer.length, expectedLength - copied);
                int read = input.read(buffer, 0, requested);
                if (read < 0) {
                    throw new IOException("File content ended before the declared length");
                }
                if (read == 0) {
                    int oneByte = input.read();
                    if (oneByte < 0) {
                        throw new IOException("File content ended before the declared length");
                    }
                    output.write(oneByte);
                    digest.update((byte) oneByte);
                    copied++;
                    continue;
                }
                output.write(buffer, 0, read);
                digest.update(buffer, 0, read);
                copied = Math.addExact(copied, read);
            }
            if (input.read() >= 0) {
                throw new IOException("File content exceeds the declared length");
            }
        }
        return copied;
    }

    private static MessageDigest sha256() {
        try {
            return MessageDigest.getInstance("SHA-256");
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException("SHA-256 is unavailable", exception);
        }
    }

    @FunctionalInterface
    interface OutputStreamFactory {
        OutputStream open(Path path) throws IOException;
    }
}
