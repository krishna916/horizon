package com.krishnamurti.horizon.file.application;

import static org.assertj.core.api.Assertions.assertThat;

import com.krishnamurti.horizon.TestcontainersConfiguration;
import com.krishnamurti.horizon.file.api.command.PrepareFileCommand;
import com.krishnamurti.horizon.file.api.model.FileDescriptor;
import com.krishnamurti.horizon.file.api.model.FileReference;
import com.krishnamurti.horizon.file.api.model.FileScope;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.ApplicationListener;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.context.annotation.Import;
import org.springframework.context.event.ContextClosedEvent;
import org.springframework.core.Ordered;
import org.springframework.jdbc.core.JdbcTemplate;

@SpringBootTest(
        properties = {
            "horizon.file.recovery.enabled=true",
            "horizon.file.recovery.poll-interval=100ms"
        })
@Import({TestcontainersConfiguration.class, FileApplicationTestConfiguration.class})
class FileRecoveryShutdownIntegrationTest {
    @Autowired private ConfigurableApplicationContext context;
    @Autowired private FileRecoveryWorker worker;
    @Autowired private TestFileOwner owner;
    @Autowired private FileTransactions transfers;
    @Autowired private RecordingObjectStorage storage;
    @Autowired private JdbcTemplate jdbc;

    @Test
    void contextClosedEventDuringDeleteStopsFurtherCandidateAdmission() throws Exception {
        FilePrepareIntegrationTest.ensureUsers(jdbc);
        jdbc.update("UPDATE file_metadata SET claimed_at=NULL, selected_attempt_id=NULL");
        jdbc.update("DELETE FROM file_transfer_attempt");
        jdbc.update("DELETE FROM file_metadata");
        storage.reset();
        var scope = new FileScope(71L, "shutdown", "a".repeat(64));
        var first = pendingAttempt(scope, "first.txt");
        var second = pendingAttempt(scope, "second.txt");
        jdbc.update(
                "UPDATE file_transfer_attempt SET cleanup_requested_at=now(),next_cleanup_at="
                        + "case when id=? then now()-interval '1 second' else now() end WHERE"
                        + " id IN (?,?)",
                first.attemptId(),
                first.attemptId(),
                second.attemptId());

        CountDownLatch deleteEntered = new CountDownLatch(1);
        CountDownLatch releaseDelete = new CountDownLatch(1);
        CountDownLatch closedEvent = new CountDownLatch(1);
        AtomicInteger deletes = new AtomicInteger();
        storage.deleteHook(
                key -> {
                    if (deletes.incrementAndGet() == 1) {
                        deleteEntered.countDown();
                        try {
                            if (!releaseDelete.await(10, TimeUnit.SECONDS))
                                throw new IllegalStateException("test DELETE barrier timed out");
                        } catch (InterruptedException exception) {
                            Thread.currentThread().interrupt();
                            throw new IllegalStateException(exception);
                        }
                    }
                });
        class CloseListener implements ApplicationListener<ContextClosedEvent>, Ordered {
            @Override
            public int getOrder() {
                return Ordered.LOWEST_PRECEDENCE;
            }

            @Override
            public void onApplicationEvent(ContextClosedEvent event) {
                if (event.getApplicationContext().equals(context)) closedEvent.countDown();
            }
        }
        context.addApplicationListener(new CloseListener());

        assertThat(deleteEntered.await(10, TimeUnit.SECONDS)).isTrue();
        Boolean secondLeaseWasUnchanged;
        try {
            context.publishEvent(new ContextClosedEvent(context));
            assertThat(closedEvent.await(10, TimeUnit.SECONDS)).isTrue();
            assertThat(worker.isAcceptingWork()).isFalse();
            secondLeaseWasUnchanged =
                    jdbc.queryForObject(
                            "SELECT cleanup_lease_token IS NULL FROM file_transfer_attempt"
                                    + " WHERE id=?",
                            Boolean.class,
                            second.attemptId());
        } finally {
            releaseDelete.countDown();
        }

        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5);
        while (worker.isAcceptingWork() && System.nanoTime() < deadline) Thread.sleep(10);
        Thread.sleep(250);

        assertThat(deletes.get()).isEqualTo(1);
        assertThat(storage.deleteCount()).isEqualTo(1);
        assertThat(secondLeaseWasUnchanged).isTrue();
        assertThat(worker.isAcceptingWork()).isFalse();
    }

    private FileTransactions.Registration pendingAttempt(FileScope scope, String name) {
        var snapshot =
                owner.prepare(
                        new PrepareFileCommand(
                                UUID.randomUUID(),
                                scope,
                                new FileDescriptor(name, "text/plain", 1L, "b".repeat(64))));
        return transfers.registerAttempt(new FileReference(snapshot.fileId(), scope));
    }
}
