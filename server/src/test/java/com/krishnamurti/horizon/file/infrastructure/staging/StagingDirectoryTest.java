package com.krishnamurti.horizon.file.infrastructure.staging;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class StagingDirectoryTest {
    @TempDir Path temporaryDirectory;

    @Test
    void secondProcessCannotSweepActiveFiles() throws Exception {
        Path directoryPath = temporaryDirectory.resolve("stage");
        try (StagingDirectory owner = new StagingDirectory(directoryPath)) {
            Path active = owner.createTempFile();
            Files.writeString(active, "active transfer");
            assertThatThrownBy(() -> new StagingDirectory(directoryPath))
                    .isInstanceOf(IllegalStateException.class);
            assertThat(Files.readString(active)).isEqualTo("active transfer");
        }
    }

    @Test
    void restrictsPosixDirectoryAndPayloadPermissions() throws Exception {
        Path directoryPath = temporaryDirectory.resolve("private-stage");
        try (StagingDirectory directory = new StagingDirectory(directoryPath)) {
            try {
                assertThat(Files.getPosixFilePermissions(directoryPath))
                        .containsExactlyInAnyOrder(
                                java.nio.file.attribute.PosixFilePermission.OWNER_READ,
                                java.nio.file.attribute.PosixFilePermission.OWNER_WRITE,
                                java.nio.file.attribute.PosixFilePermission.OWNER_EXECUTE);
                Path payload = directory.createTempFile();
                assertThat(Files.getPosixFilePermissions(payload))
                        .containsExactlyInAnyOrder(
                                java.nio.file.attribute.PosixFilePermission.OWNER_READ,
                                java.nio.file.attribute.PosixFilePermission.OWNER_WRITE);
            } catch (UnsupportedOperationException exception) {
                org.junit.jupiter.api.Assumptions.abort(
                        "POSIX permissions are not available on this platform");
            }
        }
    }

    @Test
    void startupRemovesOnlyAbandonedOwnedFilesAndSkipsSymlinks() throws Exception {
        Path directoryPath = temporaryDirectory.resolve("stage");
        Files.createDirectories(directoryPath);
        Path stale = directoryPath.resolve("horizon-file-abandoned.stage");
        Path unrelated = directoryPath.resolve("keep.txt");
        Path target = directoryPath.resolve("outside.txt");
        Path symlink = directoryPath.resolve("horizon-file-link.stage");
        Files.writeString(stale, "stale");
        Files.writeString(unrelated, "keep");
        Files.writeString(target, "target");
        try {
            Files.createSymbolicLink(symlink, target.getFileName());
        } catch (UnsupportedOperationException | java.io.IOException exception) {
            symlink = null;
        }

        try (StagingDirectory ignored = new StagingDirectory(directoryPath)) {
            assertThat(Files.exists(stale)).isFalse();
            assertThat(Files.readString(unrelated)).isEqualTo("keep");
            assertThat(Files.readString(target)).isEqualTo("target");
            if (symlink != null) assertThat(Files.isSymbolicLink(symlink)).isTrue();
        }
    }
}
