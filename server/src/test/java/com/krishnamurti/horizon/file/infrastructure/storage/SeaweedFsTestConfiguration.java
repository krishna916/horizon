package com.krishnamurti.horizon.file.infrastructure.storage;

import java.nio.file.Path;
import java.time.Duration;
import org.testcontainers.containers.BindMode;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.utility.DockerImageName;

/** Isolated authenticated SeaweedFS fixture using only per-test temporary storage. */
public final class SeaweedFsTestConfiguration {

    public static final String ACCESS_KEY = "horizon-test-access";
    public static final String SECRET_KEY = "horizon-test-secret-only";
    public static final String BUCKET = "horizon-file-test";

    private static final DockerImageName SEAWEEDFS =
            DockerImageName.parse(
                    "ghcr.io/chrislusf/seaweedfs:4.54@sha256:e7d4b80af9bd49b2630a60ac6fbb7ffb620ac6a2c501f689c22a71b9f89f0203");

    private SeaweedFsTestConfiguration() {}

    public static GenericContainer<?> container(Path privateTestDataDirectory) {
        return new GenericContainer<>(SEAWEEDFS)
                .withEnv("AWS_ACCESS_KEY_ID", ACCESS_KEY)
                .withEnv("AWS_SECRET_ACCESS_KEY", SECRET_KEY)
                .withEnv("S3_BUCKET", BUCKET)
                .withExposedPorts(8333)
                .withFileSystemBind(
                        privateTestDataDirectory.toString(), "/data", BindMode.READ_WRITE)
                .withStartupTimeout(Duration.ofSeconds(90));
    }
}
