package com.krishnamurti.horizon.file.infrastructure.storage;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.krishnamurti.horizon.file.application.port.ObjectKey;
import com.krishnamurti.horizon.file.application.port.ObjectMetadata;
import com.krishnamurti.horizon.file.application.port.StoredObject;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;

class ObjectStorageContractTest {

    @Test
    void objectKeyRejectsTraversalAndControlCharacters() {
        assertThatThrownBy(() -> new ObjectKey("../outside"))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> new ObjectKey("key\nvalue"))
                .isInstanceOf(IllegalArgumentException.class);
        assertThat(new ObjectKey("files/opaque-id").value()).isEqualTo("files/opaque-id");
    }

    @Test
    void missingMetadataCannotBeConfusedWithProviderMetadata() {
        assertThat(ObjectMetadata.missing()).isEqualTo(new ObjectMetadata(false, 0, null));
        assertThatThrownBy(() -> new ObjectMetadata(false, 0, "text/plain"))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void closingStoredObjectClosesProviderStreamExactlyOnce() throws IOException {
        AtomicInteger closes = new AtomicInteger();
        InputStream providerStream =
                new ByteArrayInputStream("payload".getBytes(StandardCharsets.UTF_8)) {
                    @Override
                    public void close() throws IOException {
                        closes.incrementAndGet();
                        super.close();
                    }
                };
        StoredObject stored = new StoredObject(providerStream, 7, "text/plain");

        stored.close();
        stored.close();

        assertThat(closes).hasValue(1);
        assertThatThrownBy(stored::content).isInstanceOf(IllegalStateException.class);
    }

    @Test
    void awsSdkTypesAreConfinedToTheS3InfrastructureAdapter() throws IOException {
        Path fileRoot = Path.of("src/main/java/com/krishnamurti/horizon/file");
        try (var paths = Files.walk(fileRoot)) {
            assertThat(paths.filter(path -> path.toString().endsWith(".java")))
                    .isNotEmpty()
                    .allSatisfy(
                            path -> {
                                try {
                                    boolean importsAws =
                                            Files.readAllLines(path).stream()
                                                    .anyMatch(
                                                            line ->
                                                                    line.startsWith(
                                                                            "import"
                                                                                + " software.amazon.awssdk."));
                                    if (importsAws) {
                                        assertThat(path.toString())
                                                .contains("/infrastructure/storage/s3/");
                                    }
                                } catch (IOException e) {
                                    throw new java.io.UncheckedIOException(e);
                                }
                            });
        }
    }
}
