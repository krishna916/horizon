package com.krishnamurti.horizon.file.infrastructure.storage.s3;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.krishnamurti.horizon.file.application.port.DeleteResult;
import com.krishnamurti.horizon.file.application.port.ObjectKey;
import com.krishnamurti.horizon.file.application.port.ObjectMetadata;
import com.krishnamurti.horizon.file.application.port.ObjectStorageException;
import com.krishnamurti.horizon.file.application.port.ObjectWriteRequest;
import com.krishnamurti.horizon.file.application.port.StoredObject;
import com.krishnamurti.horizon.file.application.port.WriteResult;
import com.krishnamurti.horizon.file.infrastructure.FileProperties;
import com.krishnamurti.horizon.file.infrastructure.storage.SeaweedFsTestConfiguration;
import com.sun.net.httpserver.HttpServer;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import org.testcontainers.containers.GenericContainer;
import software.amazon.awssdk.auth.credentials.AwsBasicCredentials;
import software.amazon.awssdk.auth.credentials.StaticCredentialsProvider;

class S3ObjectStorageIntegrationTest {

    private static final String ACCESS_KEY = SeaweedFsTestConfiguration.ACCESS_KEY;
    private static final String SECRET_KEY = SeaweedFsTestConfiguration.SECRET_KEY;
    private static final String BUCKET = SeaweedFsTestConfiguration.BUCKET;

    @Test
    void privatePutHeadGetDeleteRoundTripAndUnsignedRequestIsDenied() throws Exception {
        Path data = Files.createTempDirectory("horizon-seaweedfs-");
        Path volume = Files.createDirectories(data.resolve("storage"));
        try (var seaweed = SeaweedFsTestConfiguration.container(volume)) {
            seaweed.start();
            S3ObjectStorage storage = storage(endpoint(seaweed));
            String keyValue = "test/" + UUID.randomUUID();
            ObjectKey key = new ObjectKey(keyValue);
            byte[] payload = "private file payload".getBytes(StandardCharsets.UTF_8);
            Path staged = Files.createTempFile("horizon-staged-", ".txt");
            Files.write(staged, payload);
            try {
                assertThat(
                                storage.put(
                                        new ObjectWriteRequest(
                                                key, staged, payload.length, "text/plain")))
                        .isEqualTo(WriteResult.ACKNOWLEDGED);
                storage.checkAvailability();
                ObjectMetadata metadata = storage.head(key);
                assertThat(metadata.found()).isTrue();
                assertThat(metadata.contentLength()).isEqualTo(payload.length);
                assertThat(metadata.contentType()).isEqualTo("text/plain");
                try (StoredObject object = storage.get(key);
                        ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                    object.content().transferTo(output);
                    assertThat(output.toByteArray()).isEqualTo(payload);
                }
                assertThat(storage.delete(key)).isEqualTo(DeleteResult.ACKNOWLEDGED);
                assertThat(storage.head(key)).isEqualTo(ObjectMetadata.missing());
                unsignedGet(endpoint(seaweed), keyValue);
            } finally {
                storage.close();
                Files.deleteIfExists(staged);
            }
            makeContainerOwnedDirectoryReadOnly(seaweed);
            makeContainerDataRemovable(seaweed);
        } finally {
            deleteTree(data);
        }
    }

    @Test
    void storagePersistsAcrossContainerRecreationWithTheSamePrivateVolume() throws Exception {
        Path data = Files.createTempDirectory("horizon-seaweedfs-persist-");
        Path volume = Files.createDirectories(data.resolve("storage"));
        byte[] payload = "survives container recreation".getBytes(StandardCharsets.UTF_8);
        Path staged = Files.createTempFile("horizon-staged-", ".txt");
        Files.write(staged, payload);
        ObjectKey key = new ObjectKey("persist/" + UUID.randomUUID());
        try (var first = SeaweedFsTestConfiguration.container(volume)) {
            first.start();
            S3ObjectStorage initial = storage(endpoint(first));
            assertThat(
                            initial.put(
                                    new ObjectWriteRequest(
                                            key, staged, payload.length, "text/plain")))
                    .isEqualTo(WriteResult.ACKNOWLEDGED);
            initial.close();
            first.stop();

            try (var recreated = SeaweedFsTestConfiguration.container(volume)) {
                recreated.start();
                S3ObjectStorage afterRestart = storage(endpoint(recreated));
                try (StoredObject object = afterRestart.get(key);
                        ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                    object.content().transferTo(output);
                    assertThat(output.toByteArray()).isEqualTo(payload);
                } finally {
                    afterRestart.close();
                }
                makeContainerOwnedDirectoryReadOnly(recreated);
                makeContainerDataRemovable(recreated);
            }
        } finally {
            Files.deleteIfExists(staged);
            deleteTree(data);
        }
    }

    @Test
    void providerFailureIsNotNotFound() throws Exception {
        FileProperties properties = properties(URI.create("http://127.0.0.1:1"));
        try (S3Configuration.Clients clients = clients(properties)) {
            S3ObjectStorage storage = new S3ObjectStorage(clients.write(), clients.read(), BUCKET);
            assertThatThrownBy(() -> storage.head(new ObjectKey("missing")))
                    .isInstanceOf(ObjectStorageException.class);
        }
    }

    @Test
    void putMakesExactlyOneNetworkRequestAndReturnsUnknownForProviderFailure() throws Exception {
        AtomicInteger puts = new AtomicInteger();
        HttpServer server = fakeS3(puts, 500, 0);
        try {
            FileProperties properties =
                    properties(URI.create("http://127.0.0.1:" + server.getAddress().getPort()));
            Path staged = Files.createTempFile("horizon-staged-", ".bin");
            Files.writeString(staged, "one request");
            try (S3Configuration.Clients clients = clients(properties)) {
                S3ObjectStorage storage =
                        new S3ObjectStorage(clients.write(), clients.read(), BUCKET);
                assertThat(
                                storage.put(
                                        new ObjectWriteRequest(
                                                new ObjectKey("one-put"),
                                                staged,
                                                11,
                                                "application/octet-stream")))
                        .isEqualTo(WriteResult.UNKNOWN);
                assertThat(puts).hasValue(1);
            } finally {
                Files.deleteIfExists(staged);
            }
        } finally {
            server.stop(0);
        }
    }

    @Test
    void lostSuccessfulPutResponseIsUnknownButIndependentGetFindsCommittedBytes() throws Exception {
        AtomicInteger puts = new AtomicInteger();
        java.util.Map<String, byte[]> committedObjects = new ConcurrentHashMap<>();
        HttpServer server =
                HttpServer.create(new InetSocketAddress(InetAddress.getLoopbackAddress(), 0), 0);
        server.setExecutor(Runnable::run);
        server.createContext(
                "/",
                exchange -> {
                    String key = exchange.getRequestURI().getPath();
                    if ("PUT".equals(exchange.getRequestMethod())) {
                        puts.incrementAndGet();
                        byte[] requestBytes =
                                decodeAwsChunked(exchange.getRequestBody().readAllBytes());
                        committedObjects.put(key, requestBytes);
                        // Model the provider committing the object before its 200 response is lost.
                        exchange.getResponseBody().close();
                        exchange.close();
                    } else if ("GET".equals(exchange.getRequestMethod())) {
                        byte[] bytes = committedObjects.get(key);
                        if (bytes == null) {
                            exchange.sendResponseHeaders(404, -1);
                        } else {
                            exchange.getResponseHeaders().add("Content-Type", "image/webp");
                            exchange.sendResponseHeaders(200, bytes.length);
                            exchange.getResponseBody().write(bytes);
                        }
                        exchange.close();
                    } else {
                        exchange.sendResponseHeaders(405, -1);
                        exchange.close();
                    }
                });
        server.start();

        Path staged = Files.createTempFile("horizon-lost-response-", ".webp");
        byte[] payload = "committed-before-response-loss".getBytes(StandardCharsets.UTF_8);
        Files.write(staged, payload);
        try (S3ObjectStorage storage = storage(endpoint(server))) {
            ObjectKey key = new ObjectKey("lost-response/" + UUID.randomUUID());

            assertThat(
                            storage.put(
                                    new ObjectWriteRequest(
                                            key, staged, payload.length, "image/webp")))
                    .isEqualTo(WriteResult.UNKNOWN);
            assertThat(puts).hasValue(1);
            byte[] committed = committedObjects.values().iterator().next();
            assertThat(committed).containsExactly(payload);
            try (StoredObject object = storage.get(key)) {
                assertThat(object.contentLength()).isEqualTo(payload.length);
                assertThat(object.content().readAllBytes()).containsExactly(payload);
            }
        } finally {
            server.stop(0);
            Files.deleteIfExists(staged);
        }
    }

    @Test
    void putDoesNotFollowProviderRedirectOrReplayTheRequest() throws Exception {
        AtomicInteger puts = new AtomicInteger();
        HttpServer server = fakeS3(puts, 301, 0);
        try {
            FileProperties properties =
                    properties(URI.create("http://127.0.0.1:" + server.getAddress().getPort()));
            Path staged = Files.createTempFile("horizon-staged-", ".bin");
            Files.writeString(staged, "do not redirect");
            try (S3Configuration.Clients clients = clients(properties)) {
                S3ObjectStorage storage =
                        new S3ObjectStorage(clients.write(), clients.read(), BUCKET);
                assertThat(
                                storage.put(
                                        new ObjectWriteRequest(
                                                new ObjectKey("no-redirect"),
                                                staged,
                                                15,
                                                "application/octet-stream")))
                        .isEqualTo(WriteResult.UNKNOWN);
                assertThat(puts).hasValue(1);
            } finally {
                Files.deleteIfExists(staged);
            }
        } finally {
            server.stop(0);
        }
    }

    @Test
    void boundedTimeoutReturnsUncertainWithoutReplayingPut() throws Exception {
        AtomicInteger puts = new AtomicInteger();
        HttpServer server = fakeS3(puts, 200, 1_000);
        try {
            FileProperties properties =
                    properties(URI.create("http://127.0.0.1:" + server.getAddress().getPort()));
            properties.getStorage().getS3().setOperationTimeout(Duration.ofMillis(200));
            properties.getStorage().getS3().setSocketTimeout(Duration.ofMillis(150));
            Path staged = Files.createTempFile("horizon-staged-", ".bin");
            Files.writeString(staged, "timeout payload");
            try (S3Configuration.Clients clients = clients(properties)) {
                S3ObjectStorage storage =
                        new S3ObjectStorage(clients.write(), clients.read(), BUCKET);
                assertThat(
                                storage.put(
                                        new ObjectWriteRequest(
                                                new ObjectKey("timeout"),
                                                staged,
                                                15,
                                                "application/octet-stream")))
                        .isEqualTo(WriteResult.UNKNOWN);
                assertThat(puts).hasValue(1);
            } finally {
                Files.deleteIfExists(staged);
            }
        } finally {
            server.stop(0);
        }
    }

    private static URI endpoint(org.testcontainers.containers.GenericContainer<?> seaweed) {
        return URI.create("http://" + seaweed.getHost() + ":" + seaweed.getMappedPort(8333));
    }

    private static URI endpoint(HttpServer server) {
        return URI.create("http://127.0.0.1:" + server.getAddress().getPort());
    }

    private static FileProperties properties(URI endpoint) {
        FileProperties properties = new FileProperties();
        var s3 = properties.getStorage().getS3();
        s3.setEndpoint(endpoint.toString());
        s3.setBucket(BUCKET);
        s3.setPathStyleAccess(true);
        s3.setOperationTimeout(Duration.ofSeconds(8));
        s3.setSocketTimeout(Duration.ofSeconds(5));
        return properties;
    }

    private static S3ObjectStorage storage(URI endpoint) {
        FileProperties properties = properties(endpoint);
        S3Configuration.Clients clients = clients(properties);
        return new S3ObjectStorage(clients.write(), clients.read(), BUCKET, clients);
    }

    private static S3Configuration.Clients clients(FileProperties properties) {
        return S3Configuration.createClients(
                properties.getStorage().getS3(),
                StaticCredentialsProvider.create(
                        AwsBasicCredentials.create(ACCESS_KEY, SECRET_KEY)));
    }

    private static void unsignedGet(URI endpoint, String key)
            throws IOException, InterruptedException {
        java.net.http.HttpResponse<Void> response =
                java.net.http.HttpClient.newHttpClient()
                        .send(
                                java.net.http.HttpRequest.newBuilder(
                                                endpoint.resolve("/" + BUCKET + "/" + key))
                                        .GET()
                                        .build(),
                                java.net.http.HttpResponse.BodyHandlers.discarding());
        assertThat(response.statusCode()).isEqualTo(403);
    }

    private static HttpServer fakeS3(AtomicInteger puts, int responseStatus, long delayMillis)
            throws IOException {
        HttpServer server =
                HttpServer.create(new InetSocketAddress(InetAddress.getLoopbackAddress(), 0), 0);
        server.setExecutor(Runnable::run);
        server.createContext(
                "/",
                exchange -> {
                    if ("PUT".equals(exchange.getRequestMethod())) puts.incrementAndGet();
                    exchange.getRequestBody().transferTo(OutputStreamSink.INSTANCE);
                    if (delayMillis > 0) {
                        try {
                            Thread.sleep(delayMillis);
                        } catch (InterruptedException e) {
                            Thread.currentThread().interrupt();
                        }
                    }
                    try {
                        if (responseStatus == 301) {
                            exchange.getResponseHeaders().add("Location", "/redirected");
                        }
                        exchange.sendResponseHeaders(responseStatus, -1);
                    } catch (IOException ignored) {
                        // Expected after the SDK's bounded timeout closes the connection.
                    } finally {
                        exchange.close();
                    }
                });
        server.start();
        return server;
    }

    private static byte[] decodeAwsChunked(byte[] encoded) throws IOException {
        ByteArrayOutputStream decoded = new ByteArrayOutputStream();
        int cursor = 0;
        while (cursor < encoded.length) {
            int lineEnd = findCrlf(encoded, cursor);
            String chunkHeader =
                    new String(encoded, cursor, lineEnd - cursor, StandardCharsets.US_ASCII);
            int chunkLength = Integer.parseInt(chunkHeader.split(";", 2)[0], 16);
            cursor = lineEnd + 2;
            if (chunkLength == 0) break;
            decoded.write(encoded, cursor, chunkLength);
            cursor += chunkLength;
            if (encoded[cursor] != '\r' || encoded[cursor + 1] != '\n') {
                throw new IOException("Malformed AWS chunk framing in test request");
            }
            cursor += 2;
        }
        return decoded.toByteArray();
    }

    private static int findCrlf(byte[] bytes, int start) throws IOException {
        for (int index = start; index < bytes.length - 1; index++) {
            if (bytes[index] == '\r' && bytes[index + 1] == '\n') return index;
        }
        throw new IOException("Malformed AWS chunk header in test request");
    }

    private static void deleteTree(Path root) throws IOException {
        try (var paths = Files.walk(root)) {
            for (Path path : paths.sorted(java.util.Comparator.reverseOrder()).toList())
                Files.deleteIfExists(path);
        }
    }

    private static void makeContainerOwnedDirectoryReadOnly(GenericContainer<?> container)
            throws IOException, InterruptedException {
        var result =
                container.execInContainer(
                        "sh",
                        "-c",
                        "mkdir -p /data/cleanup-test && touch /data/cleanup-test/object && chmod"
                                + " 0555 /data/cleanup-test");
        assertThat(result.getExitCode()).isZero();
    }

    private static void makeContainerDataRemovable(GenericContainer<?> container)
            throws IOException, InterruptedException {
        var result = container.execInContainer("sh", "-c", "chmod -R a+rwX /data");
        assertThat(result.getExitCode()).isZero();
    }

    private static final class OutputStreamSink extends java.io.OutputStream {
        static final OutputStreamSink INSTANCE = new OutputStreamSink();

        @Override
        public void write(int value) {}

        @Override
        public void write(byte[] bytes, int offset, int length) {}
    }
}
