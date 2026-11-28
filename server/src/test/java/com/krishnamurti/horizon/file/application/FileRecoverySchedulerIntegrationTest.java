package com.krishnamurti.horizon.file.application;

import static org.assertj.core.api.Assertions.assertThat;
import static org.awaitility.Awaitility.await;

import com.krishnamurti.horizon.TestcontainersConfiguration;
import com.krishnamurti.horizon.file.api.command.PrepareFileCommand;
import com.krishnamurti.horizon.file.api.model.FileDescriptor;
import com.krishnamurti.horizon.file.api.model.FileReference;
import com.krishnamurti.horizon.file.api.model.FileScope;
import java.time.Duration;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.support.TransactionSynchronizationManager;

@SpringBootTest(
        properties = {
            "horizon.file.recovery.enabled=true",
            "horizon.file.recovery.poll-interval=100ms"
        })
@Import({TestcontainersConfiguration.class, FileApplicationTestConfiguration.class})
class FileRecoverySchedulerIntegrationTest {
    @Autowired TestFileOwner owner;
    @Autowired FileTransactions transfers;
    @Autowired RecordingObjectStorage storage;
    @Autowired JdbcTemplate jdbc;

    @Test
    void enabledManagedSchedulerEventuallyProcessesDueRow() throws Exception {
        FilePrepareIntegrationTest.ensureUsers(jdbc);
        var scope = new FileScope(71L, "notes", "a".repeat(64));
        var snapshot =
                owner.prepare(
                        new PrepareFileCommand(
                                UUID.randomUUID(),
                                scope,
                                new FileDescriptor("x.txt", "text/plain", 1L, "b".repeat(64))));
        var ref = new FileReference(snapshot.fileId(), scope);
        var attempt = transfers.registerAttempt(ref);
        var called = new CountDownLatch(1);
        storage.deleteHook(
                key -> {
                    assertThat(TransactionSynchronizationManager.isActualTransactionActive())
                            .isFalse();
                    called.countDown();
                });
        jdbc.update(
                "UPDATE file_transfer_attempt SET cleanup_requested_at=now() WHERE id=?",
                attempt.attemptId());
        assertThat(called.await(10, TimeUnit.SECONDS)).isTrue();
        await().atMost(Duration.ofSeconds(10))
                .untilAsserted(
                        () ->
                                assertThat(
                                                jdbc.queryForObject(
                                                        "SELECT next_cleanup_at IS NOT NULL AND"
                                                            + " cleanup_lease_token IS NULL AND"
                                                            + " object_key IS NOT NULL FROM"
                                                            + " file_transfer_attempt WHERE id=?",
                                                        Boolean.class,
                                                        attempt.attemptId()))
                                        .isTrue());
    }
}
