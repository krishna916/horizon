package com.krishnamurti.horizon.file.application;

import static org.assertj.core.api.Assertions.assertThat;

import com.krishnamurti.horizon.HorizonApplication;
import com.krishnamurti.horizon.file.api.FileService;
import com.krishnamurti.horizon.file.api.command.PrepareFileCommand;
import com.krishnamurti.horizon.file.api.model.FileDescriptor;
import com.krishnamurti.horizon.file.api.model.FileReference;
import com.krishnamurti.horizon.file.api.model.FileScope;
import com.krishnamurti.horizon.file.api.query.InspectFileQuery;
import com.krishnamurti.horizon.file.application.port.ObjectStorage;
import com.krishnamurti.horizon.file.domain.TransferOutcome;
import com.krishnamurti.horizon.file.infrastructure.persistence.FileTransferAttemptRepository;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.boot.WebApplicationType;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.testcontainers.postgresql.PostgreSQLContainer;
import org.testcontainers.utility.DockerImageName;

/** Verifies durable pending-attempt state after the application context is recreated. */
class FileRestartIntegrationTest {
    @Test
    void pendingAttemptSurvivesApplicationContextRestartAgainstSameDatabaseAndStorage()
            throws Exception {
        Path staging = Files.createTempDirectory("horizon-file-restart-staging-");
        RecordingObjectStorage sharedStorage = new RecordingObjectStorage();
        try (PostgreSQLContainer database =
                new PostgreSQLContainer(DockerImageName.parse("postgres:17"))) {
            database.start();
            UUID fileId;
            UUID idempotencyKey = UUID.randomUUID();
            String objectKey;
            FileScope scope = scope(79L, "restart-binding");
            String digest = sha256("data".getBytes(StandardCharsets.UTF_8));
            try (ConfigurableApplicationContext first = start(database, staging, sharedStorage)) {
                JdbcTemplate jdbc = first.getBean(JdbcTemplate.class);
                jdbc.update(
                        "insert into users (id, email, password_hash, first_name, last_name,"
                                + " created_at, updated_at) values (79, 'restart@example.test',"
                                + " 'test-hash', 'Restart', 'Test', now(), now())");
                FileService files = first.getBean(FileService.class);
                var prepared =
                        new TransactionTemplate(first.getBean(PlatformTransactionManager.class))
                                .execute(
                                        status ->
                                                files.prepare(
                                                        new PrepareFileCommand(
                                                                idempotencyKey,
                                                                scope,
                                                                new FileDescriptor(
                                                                        "restart.webp",
                                                                        "image/webp",
                                                                        4,
                                                                        digest))));
                fileId = prepared.fileId();
                FileReference reference = new FileReference(fileId, scope);
                FileTransactions transactions = first.getBean(FileTransactions.class);
                var registration = transactions.registerAttempt(reference);
                objectKey = registration.key().value();
                assertThat(sharedStorage.putCount()).isZero();
            }

            try (ConfigurableApplicationContext restarted =
                    start(database, staging, sharedStorage)) {
                FileReference reference = new FileReference(fileId, scope);
                assertThat(
                                restarted
                                        .getBean(FileService.class)
                                        .inspect(new InspectFileQuery(reference))
                                        .fileId())
                        .isEqualTo(fileId);
                var attempt =
                        restarted
                                .getBean(FileTransferAttemptRepository.class)
                                .findAllByFileIdOrderByCreatedAtAsc(fileId)
                                .getFirst();
                assertThat(attempt.getOutcome()).isEqualTo(TransferOutcome.PENDING);
                assertThat(attempt.getObjectKey()).isEqualTo(objectKey);
                assertThat(attempt.getWriteSettledAt()).isNull();
                assertThat(sharedStorage.putCount()).isZero();
            }
        } finally {
            sharedStorage.reset();
            try (var paths = Files.walk(staging)) {
                for (Path path : paths.sorted(java.util.Comparator.reverseOrder()).toList()) {
                    Files.deleteIfExists(path);
                }
            }
        }
    }

    private static ConfigurableApplicationContext start(
            PostgreSQLContainer database, Path staging, RecordingObjectStorage storage) {
        RestartStorageConfiguration.sharedStorage = storage;
        return new SpringApplicationBuilder(
                        HorizonApplication.class, RestartStorageConfiguration.class)
                .web(WebApplicationType.NONE)
                .properties(
                        Map.of(
                                "spring.datasource.url", database.getJdbcUrl(),
                                "spring.datasource.username", database.getUsername(),
                                "spring.datasource.password", database.getPassword(),
                                "spring.main.banner-mode", "off",
                                "horizon.file.staging.directory", staging.toString()))
                .run();
    }

    private static FileScope scope(long userId, String binding) {
        try {
            String fingerprint =
                    HexFormat.of()
                            .formatHex(
                                    MessageDigest.getInstance("SHA-256")
                                            .digest(binding.getBytes(StandardCharsets.UTF_8)));
            return new FileScope(userId, "notes", fingerprint);
        } catch (java.security.NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    private static String sha256(byte[] bytes) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
        } catch (java.security.NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    @TestConfiguration(proxyBeanMethods = false)
    static class RestartStorageConfiguration {
        private static RecordingObjectStorage sharedStorage;

        @Bean
        @Primary
        ObjectStorage restartObjectStorage() {
            return sharedStorage;
        }
    }
}
