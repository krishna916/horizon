package com.krishnamurti.horizon.file.infrastructure.staging;

import com.krishnamurti.horizon.file.api.FileOperationException;
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
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

@Component
public class FileStagingService {
    private static final Logger LOGGER = LoggerFactory.getLogger(FileStagingService.class);
    private final FileProperties properties;
    private final StagingCapacity capacity;
    private final StagingDirectory directory;
    private final OutputStreamFactory outputStreamFactory;
    private final FileDeleter fileDeleter;
    private final Map<Path, StagingCapacity.Reservation> retainedFiles = new ConcurrentHashMap<>();
    private final Object retainedFilesLock = new Object();

    @Autowired
    public FileStagingService(
            FileProperties properties, StagingCapacity capacity, StagingDirectory directory) {
        this(properties, capacity, directory, Files::newOutputStream, Files::deleteIfExists);
    }

    FileStagingService(
            FileProperties properties,
            StagingCapacity capacity,
            StagingDirectory directory,
            OutputStreamFactory outputStreamFactory) {
        this(properties, capacity, directory, outputStreamFactory, Files::deleteIfExists);
    }

    FileStagingService(
            FileProperties properties,
            StagingCapacity capacity,
            StagingDirectory directory,
            OutputStreamFactory outputStreamFactory,
            FileDeleter fileDeleter) {
        this.properties = properties;
        this.capacity = capacity;
        this.directory = directory;
        this.outputStreamFactory = outputStreamFactory;
        this.fileDeleter = fileDeleter;
    }

    public StagedFile stage(InputStream input, long declaredLength, FileDescriptor expected)
            throws IOException {
        if (declaredLength <= 0) {
            throw failure(
                    FileOperationException.Reason.INVALID_METADATA,
                    "File content length must be known and positive");
        }
        if (expected.expectedSize() != declaredLength) {
            throw failure(
                    FileOperationException.Reason.INVALID_METADATA,
                    "File content length does not match the prepared descriptor");
        }
        if (declaredLength > properties.getMaxFileSizeBytes()) {
            throw failure(
                    FileOperationException.Reason.SIZE_LIMIT_EXCEEDED,
                    "File exceeds the effective upload limit");
        }

        cleanupRetainedFiles();
        StagingCapacity.Reservation reservation;
        try {
            reservation = capacity.reserve(declaredLength);
        } catch (StagingCapacityException exception) {
            throw failure(
                    FileOperationException.Reason.STORAGE_UNAVAILABLE,
                    "File staging capacity is unavailable",
                    exception);
        }
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
            return new StagedFile(
                    stagedPath, actualBytes, sha256, reservation, this::closeStagedFile);
        } catch (IOException | RuntimeException | Error exception) {
            if (stagedPath != null) {
                try {
                    fileDeleter.deleteIfExists(stagedPath);
                    reservation.close();
                } catch (IOException cleanupException) {
                    exception.addSuppressed(cleanupException);
                    retain(stagedPath, reservation);
                }
            } else {
                reservation.close();
            }
            throw exception;
        }
    }

    private void closeStagedFile(Path path, StagingCapacity.Reservation reservation)
            throws IOException {
        try {
            fileDeleter.deleteIfExists(path);
            reservation.close();
        } catch (IOException exception) {
            retain(path, reservation);
            throw exception;
        }
    }

    private void retain(Path path, StagingCapacity.Reservation reservation) {
        synchronized (retainedFilesLock) {
            reservation.releaseSlot();
            retainedFiles.put(path, reservation);
        }
        LOGGER.warn(
                "Unable to remove a retained temporary File payload; its capacity remains"
                        + " reserved");
    }

    private void cleanupRetainedFiles() {
        synchronized (retainedFilesLock) {
            for (Map.Entry<Path, StagingCapacity.Reservation> entry :
                    List.copyOf(retainedFiles.entrySet())) {
                try {
                    fileDeleter.deleteIfExists(entry.getKey());
                    entry.getValue().releaseRetainedBytes();
                    retainedFiles.remove(entry.getKey(), entry.getValue());
                } catch (IOException exception) {
                    LOGGER.warn(
                            "Unable to remove a retained temporary File payload; its capacity"
                                    + " remains reserved");
                }
            }
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

    private static FileOperationException failure(
            FileOperationException.Reason reason, String message) {
        return new FileOperationException(reason, message);
    }

    private static FileOperationException failure(
            FileOperationException.Reason reason, String message, Throwable cause) {
        return new FileOperationException(reason, message, cause);
    }

    @FunctionalInterface
    interface OutputStreamFactory {
        OutputStream open(Path path) throws IOException;
    }

    @FunctionalInterface
    interface FileDeleter {
        boolean deleteIfExists(Path path) throws IOException;
    }
}
