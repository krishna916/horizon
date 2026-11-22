package com.krishnamurti.horizon.poc.s3;

import eu.rekawek.toxiproxy.Proxy;
import eu.rekawek.toxiproxy.ToxiproxyClient;
import java.io.IOException;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.HexFormat;
import java.util.UUID;
import org.testcontainers.containers.ToxiproxyContainer;
import org.testcontainers.utility.DockerImageName;
import software.amazon.awssdk.auth.credentials.AwsBasicCredentials;
import software.amazon.awssdk.auth.credentials.StaticCredentialsProvider;
import software.amazon.awssdk.core.exception.SdkException;
import software.amazon.awssdk.core.retry.RetryPolicy;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.S3Configuration;
import software.amazon.awssdk.services.s3.model.ListBucketsRequest;

final class S3Environment implements AutoCloseable {

    private static final DockerImageName TOXIPROXY_IMAGE =
            DockerImageName.parse(
                            "ghcr.io/shopify/toxiproxy:2.13.0@sha256:5d3dae09bc185dcc5ff6cf43abf6062a4a720aff0c4306a471e773acdcd107aa")
                    .asCompatibleSubstituteFor("shopify/toxiproxy");
    private static final Duration CLIENT_TIMEOUT = Duration.ofSeconds(8);
    private static final java.util.concurrent.ConcurrentMap<String, java.util.concurrent.CopyOnWriteArrayList<String>> GENERATED_KEYS =
            new java.util.concurrent.ConcurrentHashMap<>();

    private final String endpoint;
    private final String bucket;
    private final String accessKey;
    private final String secretKey;
    private final String runId = UUID.randomUUID().toString();
    private final S3Client directClient;
    private final S3Client proxiedClient;
    private final ToxiproxyContainer toxiproxy;
    private final Proxy s3Proxy;

    private S3Environment(String endpoint, String bucket, String accessKey, String secretKey) {
        this.endpoint = endpoint;
        this.bucket = bucket;
        this.accessKey = accessKey;
        this.secretKey = secretKey;
        this.directClient = clientWithCredentials(accessKey, secretKey);
        this.toxiproxy =
                new ToxiproxyContainer(TOXIPROXY_IMAGE)
                        .withExtraHost("host.docker.internal", "host-gateway");
        this.toxiproxy.start();
        try {
            ToxiproxyClient toxiproxyClient =
                    new ToxiproxyClient(toxiproxy.getHost(), toxiproxy.getControlPort());
            this.s3Proxy =
                    toxiproxyClient.createProxy("issue75-s3", "0.0.0.0:8666", "host.docker.internal:8333");
            this.proxiedClient =
                    clientWithCredentials(
                            accessKey,
                            secretKey,
                            URI.create("http://" + toxiproxy.getHost() + ":" + toxiproxy.getMappedPort(8666)));
        } catch (IOException e) {
            toxiproxy.stop();
            directClient.close();
            throw new IllegalStateException("Could not configure the isolated Toxiproxy S3 route", e);
        }
    }

    static S3Environment start() throws Exception {
        Path projectDirectory = Path.of(System.getProperty("user.dir")).toAbsolutePath().normalize();
        Path serverDirectory = projectDirectory.getParent().getParent();
        Path composeFile = projectDirectory.resolve("compose.yaml");
        if (!Files.isRegularFile(composeFile)) {
            throw new IllegalStateException("Run the POC tests from server/ so the Compose fixture is available");
        }
        runCompose(serverDirectory, composeFile, "up", "-d", "seaweedfs");

        String endpoint = environmentOrDefault("POC_S3_ENDPOINT", "http://127.0.0.1:8333");
        String bucket = environmentOrDefault("POC_S3_BUCKET", "issue75-poc");
        String accessKey = environmentOrDefault("POC_S3_ACCESS_KEY", "issue75-poc-access");
        String secretKey = environmentOrDefault("POC_S3_SECRET_KEY", "issue75-poc-secret-only");
        S3Environment environment = new S3Environment(endpoint, bucket, accessKey, secretKey);
        environment.waitForS3();
        return environment;
    }

    void recreateSeaweedfsContainer() throws Exception {
        Path projectDirectory = Path.of(System.getProperty("user.dir")).toAbsolutePath().normalize();
        Path serverDirectory = projectDirectory.getParent().getParent();
        Path composeFile = projectDirectory.resolve("compose.yaml");
        runCompose(serverDirectory, composeFile, "rm", "-s", "-f", "seaweedfs");
        runCompose(serverDirectory, composeFile, "up", "-d", "seaweedfs");
        waitForS3();
    }

    S3Client directClient() {
        return directClient;
    }

    S3Client proxiedClient() {
        return proxiedClient;
    }

    Proxy s3Proxy() {
        return s3Proxy;
    }

    String endpoint() {
        return endpoint;
    }

    String bucket() {
        return bucket;
    }

    String runId() {
        return runId;
    }

    String newObjectKey(String caseId) {
        String key = "poc/" + runId + "/" + caseId + "-" + UUID.randomUUID();
        String caseCode = caseId.length() >= 3 ? caseId.substring(0, 3) : caseId;
        GENERATED_KEYS.computeIfAbsent(runId + ":" + caseCode, ignored -> new java.util.concurrent.CopyOnWriteArrayList<>()).add(key);
        return key;
    }

    static String recordedKeys(String runId, String caseId) {
        String caseCode = caseId.length() >= 3 ? caseId.substring(0, 3) : caseId;
        return String.join(",", GENERATED_KEYS.getOrDefault(runId + ":" + caseCode, new java.util.concurrent.CopyOnWriteArrayList<>()));
    }

    S3Client clientWithCredentials(String key, String secret) {
        return clientWithCredentials(key, secret, URI.create(endpoint));
    }

    S3Client clientAt(URI clientEndpoint) {
        return clientWithCredentials(accessKey, secretKey, clientEndpoint);
    }

    byte[] deterministicBytes(String seed, int length) {
        byte[] result = new byte[length];
        int position = 0;
        int blockNumber = 0;
        try {
            var digest = java.security.MessageDigest.getInstance("SHA-256");
            while (position < length) {
                digest.update(runId.getBytes(StandardCharsets.UTF_8));
                digest.update((byte) 0);
                digest.update(seed.getBytes(StandardCharsets.UTF_8));
                digest.update((byte) 0);
                byte[] block = digest.digest(Integer.toString(blockNumber++).getBytes(StandardCharsets.UTF_8));
                int count = Math.min(block.length, length - position);
                System.arraycopy(block, 0, result, position, count);
                position += count;
            }
            return result;
        } catch (java.security.NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 is required by the Java runtime", e);
        }
    }

    private void waitForS3() throws InterruptedException {
        long deadline = System.nanoTime() + Duration.ofSeconds(60).toNanos();
        SdkException lastFailure = null;
        while (System.nanoTime() < deadline) {
            try {
                directClient.listBuckets(ListBucketsRequest.builder().build());
                return;
            } catch (SdkException e) {
                lastFailure = e;
                Thread.sleep(500);
            }
        }
        throw new IllegalStateException("SeaweedFS did not become ready within 60 seconds", lastFailure);
    }

    private S3Client clientWithCredentials(String key, String secret, URI clientEndpoint) {
        return S3Client.builder()
                .endpointOverride(clientEndpoint)
                .region(Region.US_EAST_1)
                .credentialsProvider(StaticCredentialsProvider.create(AwsBasicCredentials.create(key, secret)))
                .serviceConfiguration(S3Configuration.builder().pathStyleAccessEnabled(true).build())
                .overrideConfiguration(configuration ->
                        configuration.apiCallTimeout(CLIENT_TIMEOUT).apiCallAttemptTimeout(Duration.ofSeconds(5)).retryPolicy(RetryPolicy.none()))
                .build();
    }

    private static String environmentOrDefault(String name, String fallback) {
        String value = System.getenv(name);
        return value == null || value.isBlank() ? fallback : value;
    }

    private static void runCompose(Path serverDirectory, Path composeFile, String... arguments)
            throws IOException, InterruptedException {
        java.util.ArrayList<String> command = new java.util.ArrayList<>(
                java.util.List.of("docker", "compose", "-f", composeFile.toString()));
        command.addAll(java.util.List.of(arguments));
        Process process = new ProcessBuilder(command).directory(serverDirectory.toFile()).inheritIO().start();
        if (!process.waitFor(30, java.util.concurrent.TimeUnit.SECONDS)) {
            process.destroyForcibly();
            throw new IllegalStateException("Docker Compose command timed out");
        }
        if (process.exitValue() != 0) {
            throw new IllegalStateException("Docker Compose command failed with exit code " + process.exitValue());
        }
    }

    @Override
    public void close() {
        proxiedClient.close();
        directClient.close();
        toxiproxy.stop();
    }
}
