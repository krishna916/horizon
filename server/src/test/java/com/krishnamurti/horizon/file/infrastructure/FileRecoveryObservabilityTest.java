package com.krishnamurti.horizon.file.infrastructure;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.krishnamurti.horizon.TestcontainersConfiguration;
import com.krishnamurti.horizon.file.api.command.PrepareFileCommand;
import com.krishnamurti.horizon.file.api.model.FileDescriptor;
import com.krishnamurti.horizon.file.api.model.FileReference;
import com.krishnamurti.horizon.file.api.model.FileScope;
import com.krishnamurti.horizon.file.application.*;
import com.krishnamurti.horizon.file.infrastructure.persistence.FileRecoveryPersistence;
import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.MeterRegistry;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.actuate.endpoint.web.WebEndpointsSupplier;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.context.annotation.Import;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.jdbc.core.JdbcTemplate;

@SpringBootTest(properties = "test.recovery.metrics.context=true")
@Import({TestcontainersConfiguration.class, FileApplicationTestConfiguration.class})
@ExtendWith(OutputCaptureExtension.class)
class FileRecoveryObservabilityTest {
    @Autowired FileRecoveryWorker worker;
    @Autowired FileTransactions transfers;
    @Autowired TestFileOwner owner;
    @Autowired RecordingObjectStorage storage;
    @Autowired FileRecoveryPersistence persistence;
    @Autowired FileRecoveryTransactions recoveryTransactions;
    @Autowired RecoveryClock clock;
    @Autowired FileProperties properties;
    @Autowired FileRecoveryMetrics metrics;
    @Autowired MeterRegistry registry;
    @Autowired JdbcTemplate jdbc;
    @Autowired WebEndpointsSupplier webEndpoints;

    @BeforeEach
    void reset() {
        jdbc.update(
                "INSERT INTO"
                    + " users(id,email,password_hash,first_name,last_name,created_at,updated_at)"
                    + " VALUES (71,'metrics@test.invalid','hash','Test','User',now(),now()) ON"
                    + " CONFLICT (id) DO NOTHING");
        jdbc.update("UPDATE file_metadata SET claimed_at=NULL,selected_attempt_id=NULL");
        jdbc.update("DELETE FROM file_transfer_attempt");
        jdbc.update("DELETE FROM file_metadata");
        storage.reset();
    }

    private FileReference prepared() {
        var scope = new FileScope(71L, "notes", "a".repeat(64));
        var s =
                owner.prepare(
                        new PrepareFileCommand(
                                UUID.randomUUID(),
                                scope,
                                new FileDescriptor(
                                        "secret-name.txt", "text/plain", 1, "b".repeat(64))));
        return new FileReference(s.fileId(), scope);
    }

    @Test
    void metricsSeparateUnknownAckFromTerminalConfirmation() {
        var f1 = prepared();
        var a1 = transfers.registerAttempt(f1);
        jdbc.update(
                "UPDATE file_transfer_attempt SET cleanup_requested_at=now() WHERE id=?",
                a1.attemptId());
        var f2 = prepared();
        var a2 = transfers.registerAttempt(f2);
        transfers.recordAttempt(
                f2, a2.attemptId(), FileTransactions.AttemptResult.failed(true), null);
        worker.runCycle();
        assertThat(
                        registry.get("horizon.file.recovery.delete.outcomes")
                                .tag("outcome", "unknown_revisit")
                                .counter()
                                .count())
                .isGreaterThanOrEqualTo(1);
        assertThat(
                        registry.get("horizon.file.recovery.delete.outcomes")
                                .tag("outcome", "terminal_confirmed")
                                .counter()
                                .count())
                .isGreaterThanOrEqualTo(1);
        assertThat(registry.get("horizon.file.recovery.last.success.epoch.seconds").gauge().value())
                .isPositive();
    }

    @Test
    void countsMatchDueDiscoveryAndPendingUnknown() {
        var f = prepared();
        var a = transfers.registerAttempt(f);
        jdbc.update(
                "UPDATE file_transfer_attempt SET cleanup_requested_at=now() WHERE id=?",
                a.attemptId());
        var now = clock.now();
        var counts = persistence.recoveryCounts(now);
        assertThat(counts.unresolved()).isEqualTo(1);
        assertThat(counts.due())
                .isEqualTo(
                        persistence
                                .findCandidates(
                                        FileRecoveryPersistence.WorkKind.DELETE_ATTEMPT, now, 25)
                                .size());
        assertThat(counts.pending()).isGreaterThanOrEqualTo(1);
    }

    @Test
    void noSensitiveTagsOrRawExceptionMessage(CapturedOutput output) {
        var f = prepared();
        var a = transfers.registerAttempt(f);
        jdbc.update(
                "UPDATE file_transfer_attempt SET cleanup_requested_at=now() WHERE id=?",
                a.attemptId());
        storage.deleteHook(
                key -> {
                    throw new com.krishnamurti.horizon.file.application.port.ObjectStorageException(
                            "sensitive-user-secret-name.txt");
                });
        worker.runCycle();
        assertThat(output.getOut() + output.getErr())
                .doesNotContain("sensitive-user-secret-name.txt");
        assertThat(
                        registry.get("horizon.file.recovery.errors")
                                .tag("error", "storage_unavailable")
                                .counter()
                                .count())
                .isGreaterThanOrEqualTo(1);
        assertThat(
                        registry.getMeters().stream()
                                .filter(
                                        m ->
                                                m.getId()
                                                        .getName()
                                                        .startsWith("horizon.file.recovery"))
                                .flatMap(m -> m.getId().getTags().stream())
                                .map(t -> t.getValue())
                                .toList())
                .noneMatch(v -> v.contains("secret") || v.contains("71"));
    }

    @Test
    void expiredLeaseReclaimCountedOnce() {
        var f = prepared();
        var a = transfers.registerAttempt(f);
        jdbc.update(
                "UPDATE file_transfer_attempt SET"
                    + " cleanup_requested_at=now(),cleanup_lease_token=?,cleanup_lease_until=now()-interval"
                    + " '1 second' WHERE id=?",
                UUID.randomUUID(),
                a.attemptId());
        double before = registry.get("horizon.file.recovery.lease.reclaims").counter().count();
        worker.runCycle();
        assertThat(registry.get("horizon.file.recovery.lease.reclaims").counter().count())
                .isEqualTo(before + 1);
    }

    @Test
    void dbFailureReportsSafeCategoryWithoutFalseSuccess(CapturedOutput output) {
        var f = prepared();
        var a = transfers.registerAttempt(f);
        jdbc.update(
                "UPDATE file_transfer_attempt SET cleanup_requested_at=now() WHERE id=?",
                a.attemptId());
        var before = persistence.recoveryCounts(clock.now());
        metrics.updateCounts(before);
        double previousSuccess =
                registry.get("horizon.file.recovery.last.success.epoch.seconds").gauge().value();
        Counter dbErrors = registry.counter("horizon.file.recovery.errors", "error", "db_retry");
        double previousErrors = dbErrors.count();

        var failedPersistence = mock(FileRecoveryPersistence.class);
        when(failedPersistence.findCandidates(any(), any(), anyInt()))
                .thenReturn(java.util.List.of());
        when(failedPersistence.recoveryCounts(any()))
                .thenThrow(new DataAccessResourceFailureException("sensitive-db-password"));
        new FileRecoveryWorker(
                        failedPersistence,
                        recoveryTransactions,
                        storage,
                        clock,
                        properties,
                        metrics)
                .runCycle();

        assertThat(output.getOut() + output.getErr()).doesNotContain("sensitive-db-password");
        assertThat(dbErrors.count()).isEqualTo(previousErrors + 1);
        assertThat(registry.get("horizon.file.recovery.last.success.epoch.seconds").gauge().value())
                .isEqualTo(previousSuccess);
        assertThat(registry.get("horizon.file.recovery.unresolved").gauge().value())
                .isEqualTo((double) before.unresolved());
    }

    @Test
    void diagnosticsDoNotExposeAdditionalPublicEndpoint() {
        assertThat(webEndpoints.getEndpoints())
                .noneMatch(endpoint -> endpoint.getEndpointId().toString().contains("recovery"));
    }
}
