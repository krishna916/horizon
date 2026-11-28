package com.krishnamurti.horizon.file.application;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.krishnamurti.horizon.TestcontainersConfiguration;
import com.krishnamurti.horizon.file.api.FileOperationException;
import com.krishnamurti.horizon.file.api.FileService;
import com.krishnamurti.horizon.file.api.command.ClaimFileCommand;
import com.krishnamurti.horizon.file.api.command.PrepareFileCommand;
import com.krishnamurti.horizon.file.api.command.TransferFileCommand;
import com.krishnamurti.horizon.file.api.model.FileDescriptor;
import com.krishnamurti.horizon.file.api.model.FileReference;
import com.krishnamurti.horizon.file.api.model.FileScope;
import com.krishnamurti.horizon.file.infrastructure.persistence.PostgresRecoveryClock;
import java.io.ByteArrayInputStream;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.HexFormat;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.context.annotation.Primary;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.support.TransactionTemplate;

@SpringBootTest
@Import({
    TestcontainersConfiguration.class,
    FileApplicationTestConfiguration.class,
    FileRecoveryEligibilityIntegrationTest.ClockConfiguration.class
})
class FileRecoveryEligibilityIntegrationTest {
    @Autowired FileService files;
    @Autowired TestFileOwner owner;
    @Autowired JdbcTemplate jdbc;
    @Autowired TransactionTemplate transaction;
    @Autowired ControlledClock clock;

    @Test
    void expiryAtBoundaryDeniesClaimEvenAfterWaitedLock() throws Exception {
        FilePrepareIntegrationTest.ensureUsers(jdbc);
        byte[] bytes;
        try (var input =
                getClass().getClassLoader().getResourceAsStream("file/fixtures/static.webp")) {
            bytes = input.readAllBytes();
        }
        String digest =
                HexFormat.of()
                        .formatHex(
                                java.security.MessageDigest.getInstance("SHA-256").digest(bytes));
        FileScope scope = new FileScope(71L, "notes", "a".repeat(64));
        var snapshot =
                owner.prepare(
                        new PrepareFileCommand(
                                UUID.randomUUID(),
                                scope,
                                new FileDescriptor("x.webp", "image/webp", bytes.length, digest)));
        FileReference ref = new FileReference(snapshot.fileId(), scope);
        files.transfer(new TransferFileCommand(ref, bytes.length, new ByteArrayInputStream(bytes)));
        UUID attempt =
                jdbc.queryForObject(
                        "SELECT selected_attempt_id FROM file_metadata WHERE id=?",
                        UUID.class,
                        ref.fileId());
        Instant expiry =
                jdbc.queryForObject(
                                "SELECT expires_at FROM file_metadata WHERE id=?",
                                OffsetDateTime.class,
                                ref.fileId())
                        .toInstant();
        CountDownLatch locked = new CountDownLatch(1), release = new CountDownLatch(1);
        clock.fixed = expiry.minusSeconds(1);
        clock.observed = new CountDownLatch(1);
        try (var executor = Executors.newFixedThreadPool(2)) {
            var lock =
                    executor.submit(
                            () ->
                                    transaction.executeWithoutResult(
                                            status -> {
                                                jdbc.queryForObject(
                                                        "SELECT id FROM file_transfer_attempt WHERE"
                                                                + " id=? FOR UPDATE",
                                                        UUID.class,
                                                        attempt);
                                                locked.countDown();
                                                try {
                                                    if (!release.await(10, TimeUnit.SECONDS))
                                                        throw new IllegalStateException(
                                                                "lock wait timeout");
                                                } catch (InterruptedException e) {
                                                    Thread.currentThread().interrupt();
                                                    throw new IllegalStateException(e);
                                                }
                                            }));
            assertThat(locked.await(10, TimeUnit.SECONDS)).isTrue();
            var claim =
                    executor.submit(
                            () ->
                                    owner.inTransaction(
                                            () -> files.claim(new ClaimFileCommand(ref))));
            assertThat(clock.observed.await(10, TimeUnit.SECONDS)).isTrue();
            clock.fixed = expiry;
            release.countDown();
            lock.get(10, TimeUnit.SECONDS);
            assertThatThrownBy(() -> claim.get(10, TimeUnit.SECONDS))
                    .hasCauseInstanceOf(FileOperationException.class);
        } finally {
            release.countDown();
            clock.fixed = null;
            clock.observed = null;
        }
        assertThat(
                        jdbc.queryForObject(
                                "SELECT claimed_at IS NULL FROM file_metadata WHERE id=?",
                                Boolean.class,
                                ref.fileId()))
                .isTrue();
    }

    static class ControlledClock implements RecoveryClock {
        final PostgresRecoveryClock delegate;
        volatile Instant fixed;
        volatile CountDownLatch observed;

        ControlledClock(PostgresRecoveryClock delegate) {
            this.delegate = delegate;
        }

        public Instant now() {
            Instant result = fixed;
            CountDownLatch signal = observed;
            if (signal != null) signal.countDown();
            return result == null ? delegate.now() : result;
        }
    }

    @TestConfiguration(proxyBeanMethods = false)
    static class ClockConfiguration {
        @Bean
        @Primary
        ControlledClock testRecoveryClock(PostgresRecoveryClock clock) {
            return new ControlledClock(clock);
        }
    }
}
