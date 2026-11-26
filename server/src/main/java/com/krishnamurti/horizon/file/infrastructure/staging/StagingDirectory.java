package com.krishnamurti.horizon.file.infrastructure.staging;

import com.krishnamurti.horizon.file.infrastructure.FileProperties;
import edu.umd.cs.findbugs.annotations.SuppressFBWarnings;
import jakarta.annotation.PreDestroy;
import java.io.IOException;
import java.nio.channels.FileChannel;
import java.nio.channels.FileLock;
import java.nio.channels.OverlappingFileLockException;
import java.nio.file.DirectoryStream;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.OpenOption;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.nio.file.attribute.PosixFilePermission;
import java.nio.file.attribute.PosixFilePermissions;
import java.util.Set;
import java.util.concurrent.atomic.AtomicBoolean;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

@Component
@SuppressFBWarnings(
        value = "CT_CONSTRUCTOR_THROW",
        justification =
                "Startup must fail if private staging cannot be secured or exclusively locked;"
                        + " acquired resources are closed before throwing.")
public class StagingDirectory implements AutoCloseable {
    private static final Logger LOGGER = LoggerFactory.getLogger(StagingDirectory.class);
    private static final String PREFIX = "horizon-file-";
    private static final String SUFFIX = ".stage";
    private static final String LOCK_FILENAME = ".horizon-file-staging.lock";
    private static final Set<PosixFilePermission> DIRECTORY_PERMISSIONS =
            PosixFilePermissions.fromString("rwx------");
    private static final Set<PosixFilePermission> FILE_PERMISSIONS =
            PosixFilePermissions.fromString("rw-------");

    private final Path directory;
    private final FileChannel lockChannel;
    private final FileLock lock;
    private final AtomicBoolean closed = new AtomicBoolean();

    @Autowired
    public StagingDirectory(FileProperties properties) {
        this(Path.of(properties.getStaging().getDirectory()));
    }

    public StagingDirectory(Path configuredDirectory) {
        this.directory = configuredDirectory.toAbsolutePath().normalize();
        FileChannel channel = null;
        FileLock acquiredLock = null;
        try {
            Files.createDirectories(directory);
            if (Files.isSymbolicLink(directory)
                    || !Files.isDirectory(directory, LinkOption.NOFOLLOW_LINKS)) {
                throw new IOException("Staging path must be a dedicated real directory");
            }
            setPermissions(directory, DIRECTORY_PERMISSIONS);
            Path lockPath = directory.resolve(LOCK_FILENAME);
            if (Files.isSymbolicLink(lockPath)) {
                throw new IOException("Staging lock path must not be a symbolic link");
            }
            Set<OpenOption> options =
                    Set.of(
                            StandardOpenOption.CREATE,
                            StandardOpenOption.WRITE,
                            LinkOption.NOFOLLOW_LINKS);
            channel =
                    FileChannel.open(
                            lockPath,
                            options,
                            PosixFilePermissions.asFileAttribute(FILE_PERMISSIONS));
            setPermissions(lockPath, FILE_PERMISSIONS);
            acquiredLock = channel.tryLock();
            if (acquiredLock == null) {
                throw new IllegalStateException(
                        "File staging directory is already in use by another process");
            }
            cleanAbandonedFiles();
        } catch (OverlappingFileLockException exception) {
            closeQuietly(acquiredLock, channel);
            throw new IllegalStateException(
                    "File staging directory is already in use by this process", exception);
        } catch (IOException | RuntimeException exception) {
            closeQuietly(acquiredLock, channel);
            if (exception instanceof IllegalStateException illegalStateException) {
                throw illegalStateException;
            }
            throw new IllegalStateException(
                    "Unable to initialize private File staging directory", exception);
        }
        this.lockChannel = channel;
        this.lock = acquiredLock;
    }

    public Path createTempFile() throws IOException {
        ensureOpen();
        return Files.createTempFile(
                directory, PREFIX, SUFFIX, PosixFilePermissions.asFileAttribute(FILE_PERMISSIONS));
    }

    public Path path() {
        return directory;
    }

    @Override
    @PreDestroy
    public void close() {
        if (!closed.compareAndSet(false, true)) {
            return;
        }
        try {
            lock.release();
            lockChannel.close();
        } catch (IOException exception) {
            throw new IllegalStateException(
                    "Unable to release File staging directory lock", exception);
        }
    }

    private void cleanAbandonedFiles() throws IOException {
        try (DirectoryStream<Path> files = Files.newDirectoryStream(directory)) {
            for (Path path : files) {
                Path fileName = path.getFileName();
                if (fileName == null) continue;
                String name = fileName.toString();
                if (isOwnedStageFile(name)
                        && Files.isRegularFile(path, LinkOption.NOFOLLOW_LINKS)) {
                    Files.deleteIfExists(path);
                }
            }
        }
    }

    private static boolean isOwnedStageFile(String name) {
        return name.startsWith(PREFIX)
                && name.endsWith(SUFFIX)
                && name.length() > PREFIX.length() + SUFFIX.length();
    }

    private static void setPermissions(Path path, Set<PosixFilePermission> permissions)
            throws IOException {
        try {
            Files.setPosixFilePermissions(path, permissions);
        } catch (UnsupportedOperationException ignored) {
            // Non-POSIX deployments use the process umask and filesystem ACLs.
        }
    }

    private static void closeQuietly(FileLock lock, FileChannel channel) {
        try {
            if (lock != null && lock.isValid()) {
                lock.release();
            }
        } catch (IOException exception) {
            LOGGER.warn("Unable to release File staging lock cleanly", exception);
        }
        try {
            if (channel != null && channel.isOpen()) {
                channel.close();
            }
        } catch (IOException exception) {
            LOGGER.warn("Unable to close File staging lock channel cleanly", exception);
        }
    }

    private void ensureOpen() {
        if (closed.get()) {
            throw new IllegalStateException("File staging directory is closed");
        }
    }
}
