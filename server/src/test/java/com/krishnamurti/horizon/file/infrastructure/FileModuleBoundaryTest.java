package com.krishnamurti.horizon.file.infrastructure;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;

class FileModuleBoundaryTest {
    private static final Path FILE_MODULE = moduleSourceDirectory();

    @Test
    void noAwsImportsOutsideTheAdapter() throws IOException {
        List<Path> javaFiles = javaFiles();
        assertThat(javaFiles).isNotEmpty();
        for (Path file : javaFiles) {
            String source = Files.readString(file);
            if (!file.toString().contains("/storage/s3/")) {
                assertThat(source).doesNotContain("software.amazon.awssdk");
            }
        }
    }

    @Test
    void noFileToWorkspaceRepositoryDependency() throws IOException {
        for (Path file : javaFiles()) {
            String source = Files.readString(file);
            assertThat(source)
                    .doesNotContain("com.krishnamurti.horizon.workspace.infrastructure")
                    .doesNotContain("WorkspaceRepository")
                    .doesNotContain("NoteRepository")
                    .doesNotContain("TaskRepository")
                    .doesNotContain("JournalRepository");
        }
    }

    @Test
    void noHttpEndpointsInFileModule() throws IOException {
        for (Path file : javaFiles()) {
            String source = Files.readString(file);
            assertThat(source)
                    .doesNotContain("@RestController")
                    .doesNotContain("@RequestMapping")
                    .doesNotContain("@GetMapping")
                    .doesNotContain("@PostMapping");
        }
    }

    private static List<Path> javaFiles() throws IOException {
        try (Stream<Path> paths = Files.walk(FILE_MODULE)) {
            return paths.filter(path -> path.toString().endsWith(".java")).toList();
        }
    }

    private static Path moduleSourceDirectory() {
        Path local = Path.of("src/main/java/com/krishnamurti/horizon/file");
        return Files.isDirectory(local)
                ? local
                : Path.of("server/src/main/java/com/krishnamurti/horizon/file");
    }
}
