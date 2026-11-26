package com.krishnamurti.horizon.file.application;

import static org.assertj.core.api.Assertions.assertThat;

import com.krishnamurti.horizon.HorizonApplication;
import com.krishnamurti.horizon.file.api.FileService;
import com.krishnamurti.horizon.file.api.command.ClaimFileCommand;
import com.krishnamurti.horizon.file.api.command.PrepareFileCommand;
import com.krishnamurti.horizon.file.api.model.FileDescriptor;
import com.krishnamurti.horizon.file.api.model.FileReference;
import com.krishnamurti.horizon.file.api.model.FileScope;
import com.krishnamurti.horizon.file.api.query.ReadFileQuery;
import com.krishnamurti.horizon.file.application.port.ObjectStorage;
import com.krishnamurti.horizon.file.domain.TransferOutcome;
import com.krishnamurti.horizon.file.infrastructure.persistence.FileTransferAttemptRepository;
import com.krishnamurti.horizon.file.infrastructure.storage.SeaweedFsTestConfiguration;
import com.krishnamurti.horizon.file.infrastructure.storage.s3.RealProviderFixture;
import java.io.ByteArrayOutputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.Map;
import java.util.Properties;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.boot.WebApplicationType;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.boot.health.actuate.endpoint.HealthEndpoint;
import org.springframework.boot.health.contributor.Status;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;
import org.springframework.core.env.Environment;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.postgresql.PostgreSQLContainer;
import org.testcontainers.utility.DockerImageName;

/** Proves File records and object bytes survive a real application and provider restart. */
class FileRealRestartIntegrationTest {
    private static final byte[] WEBP = fixture("file/fixtures/static.webp");

    @Test
    void realApplicationRestartRetainsDatabaseAndObjectVolume() throws Exception {
        Path data = Files.createTempDirectory("horizon-real-file-restart-");
        Path volume = Files.createDirectories(data.resolve("objects"));
        Path staging = Files.createDirectories(data.resolve("staging"));
        UUID idempotency = UUID.randomUUID();
        FileScope scope = FilePrepareIntegrationTest.scope(98L, "real-application-restart");
        UUID completedFile;
        UUID pendingFile;
        String selectedKey;
        String pendingKey;
        GenericContainer<?> seaweed = SeaweedFsTestConfiguration.container(volume);

        try (PostgreSQLContainer database =
                new PostgreSQLContainer(DockerImageName.parse("postgres:17"))) {
            database.start();
            try {
                seaweed.start();
                String endpoint = endpoint(seaweed);
                try (ConfigurableApplicationContext first = start(database, staging, endpoint)) {
                    JdbcTemplate jdbc = first.getBean(JdbcTemplate.class);
                    jdbc.update(
                            "insert into users (id, email, password_hash, first_name, last_name,"
                                + " created_at, updated_at) values (98,"
                                + " 'real-restart@example.test', 'test-hash', 'Real', 'Restart',"
                                + " now(), now())");
                    FileService files = first.getBean(FileService.class);
                    TransactionTemplate transaction =
                            new TransactionTemplate(
                                    first.getBean(PlatformTransactionManager.class));
                    var prepared =
                            transaction.execute(
                                    status ->
                                            files.prepare(
                                                    new PrepareFileCommand(
                                                            idempotency,
                                                            scope,
                                                            new FileDescriptor(
                                                                    "restart.webp",
                                                                    "image/webp",
                                                                    WEBP.length,
                                                                    sha256(WEBP)))));
                    completedFile = prepared.fileId();
                    FileReference completedReference = new FileReference(completedFile, scope);
                    assertThat(
                                    files.transfer(
                                                    new com.krishnamurti.horizon.file.api.command
                                                            .TransferFileCommand(
                                                            completedReference,
                                                            WEBP.length,
                                                            new java.io.ByteArrayInputStream(WEBP)))
                                            .disposition())
                            .isEqualTo(
                                    com.krishnamurti.horizon.file.api.model.TransferDisposition
                                            .VERIFIED);
                    transaction.executeWithoutResult(
                            status -> files.claim(new ClaimFileCommand(completedReference)));
                    var selected =
                            first.getBean(FileTransferAttemptRepository.class)
                                    .findAllByFileIdOrderByCreatedAtAsc(completedFile)
                                    .getFirst();
                    assertThat(selected.getOutcome()).isEqualTo(TransferOutcome.VERIFIED);
                    selectedKey = selected.getObjectKey();

                    FileScope pendingScope =
                            FilePrepareIntegrationTest.scope(98L, "real-pending-restart");
                    var pending =
                            transaction.execute(
                                    status ->
                                            files.prepare(
                                                    new PrepareFileCommand(
                                                            UUID.randomUUID(),
                                                            pendingScope,
                                                            new FileDescriptor(
                                                                    "pending.webp",
                                                                    "image/webp",
                                                                    WEBP.length,
                                                                    sha256(WEBP)))));
                    pendingFile = pending.fileId();
                    var registration =
                            first.getBean(FileTransactions.class)
                                    .registerAttempt(new FileReference(pendingFile, pendingScope));
                    pendingKey = registration.key().value();
                    assertThat(first.getBean(RealProviderFixture.class).listObjects().contents())
                            .anySatisfy(object -> assertThat(object.key()).isEqualTo(selectedKey));
                }

                seaweed.stop();
                seaweed.start();
                try (ConfigurableApplicationContext restarted =
                        start(database, staging, endpoint(seaweed))) {
                    HealthEndpoint health = restarted.getBean(HealthEndpoint.class);
                    assertThat(health.healthForPath("readiness").getStatus()).isEqualTo(Status.UP);
                    assertThat(health.healthForPath("liveness").getStatus()).isEqualTo(Status.UP);
                    FileReference completedReference = new FileReference(completedFile, scope);
                    try (var content =
                                    restarted
                                            .getBean(FileService.class)
                                            .openRead(new ReadFileQuery(completedReference));
                            ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                        content.stream().transferTo(output);
                        assertThat(output.toByteArray()).containsExactly(WEBP);
                    }
                    var attempts =
                            restarted
                                    .getBean(FileTransferAttemptRepository.class)
                                    .findAllByFileIdOrderByCreatedAtAsc(pendingFile);
                    assertThat(attempts)
                            .singleElement()
                            .satisfies(
                                    attempt -> {
                                        assertThat(attempt.getOutcome())
                                                .isEqualTo(TransferOutcome.PENDING);
                                        assertThat(attempt.getObjectKey()).isEqualTo(pendingKey);
                                        assertThat(attempt.getWriteSettledAt()).isNull();
                                    });
                    assertThat(
                                    restarted
                                            .getBean(RealProviderFixture.class)
                                            .storage()
                                            .head(
                                                    new com.krishnamurti.horizon.file.application
                                                            .port.ObjectKey(selectedKey))
                                            .found())
                            .isTrue();

                    seaweed.stop();
                    assertThat(health.healthForPath("readiness").getStatus())
                            .isEqualTo(Status.DOWN);
                    assertThat(health.healthForPath("liveness").getStatus()).isEqualTo(Status.UP);
                }
            } finally {
                makeContainerDataRemovable(seaweed);
                if (seaweed.isRunning()) seaweed.stop();
            }
        } finally {
            deleteTree(data);
        }
    }

    private static ConfigurableApplicationContext start(
            PostgreSQLContainer database, Path staging, String endpoint) {
        Properties properties = new Properties();
        properties.putAll(
                Map.of(
                        "spring.datasource.url",
                        database.getJdbcUrl(),
                        "spring.datasource.username",
                        database.getUsername(),
                        "spring.datasource.password",
                        database.getPassword(),
                        "spring.main.banner-mode",
                        "off",
                        "horizon.file.staging.directory",
                        staging.toString(),
                        "horizon.file.storage.s3.endpoint",
                        endpoint,
                        "horizon.file.storage.s3.bucket",
                        SeaweedFsTestConfiguration.BUCKET,
                        "horizon.file.storage.s3.path-style-access",
                        "true",
                        "test.file.storage.endpoint",
                        endpoint));
        return new SpringApplicationBuilder(
                        HorizonApplication.class, RealProviderStorageConfiguration.class)
                .web(WebApplicationType.NONE)
                .properties(properties)
                .run();
    }

    private static String endpoint(GenericContainer<?> seaweed) {
        return "http://" + seaweed.getHost() + ":" + seaweed.getMappedPort(8333);
    }

    private static byte[] fixture(String resource) {
        try (var input =
                FileRealRestartIntegrationTest.class
                        .getClassLoader()
                        .getResourceAsStream(resource)) {
            if (input == null) throw new IllegalStateException("Missing fixture " + resource);
            return input.readAllBytes();
        } catch (java.io.IOException exception) {
            throw new java.io.UncheckedIOException(exception);
        }
    }

    private static String sha256(byte[] bytes) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
        } catch (java.security.NoSuchAlgorithmException exception) {
            throw new IllegalStateException(exception);
        }
    }

    private static void deleteTree(Path root) throws java.io.IOException {
        if (!Files.exists(root)) return;
        try (var paths = Files.walk(root)) {
            for (Path path : paths.sorted(java.util.Comparator.reverseOrder()).toList()) {
                Files.deleteIfExists(path);
            }
        }
    }

    private static void makeContainerDataRemovable(GenericContainer<?> container) {
        try {
            if (!container.isRunning()) container.start();
            var result = container.execInContainer("sh", "-c", "chmod -R a+rwX /data");
            if (result.getExitCode() != 0) {
                throw new IllegalStateException(
                        "Could not make temporary SeaweedFS data removable: " + result.getStderr());
            }
        } catch (java.io.IOException exception) {
            throw new java.io.UncheckedIOException(exception);
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException(
                    "Interrupted while preparing SeaweedFS cleanup", exception);
        }
    }

    @TestConfiguration(proxyBeanMethods = false)
    static class RealProviderStorageConfiguration {
        @Bean(destroyMethod = "close")
        RealProviderFixture restartRealProvider(Environment environment) {
            return RealProviderFixture.connect(
                    java.net.URI.create(
                            environment.getRequiredProperty("test.file.storage.endpoint")),
                    SeaweedFsTestConfiguration.BUCKET,
                    SeaweedFsTestConfiguration.ACCESS_KEY,
                    SeaweedFsTestConfiguration.SECRET_KEY);
        }

        @Bean
        @Primary
        ObjectStorage restartObjectStorage(RealProviderFixture restartRealProvider) {
            return restartRealProvider.storage();
        }
    }
}
