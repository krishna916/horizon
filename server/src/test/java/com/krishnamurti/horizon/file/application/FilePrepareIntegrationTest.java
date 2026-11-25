package com.krishnamurti.horizon.file.application;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.krishnamurti.horizon.TestcontainersConfiguration;
import com.krishnamurti.horizon.file.api.FileService;
import com.krishnamurti.horizon.file.api.command.PrepareFileCommand;
import com.krishnamurti.horizon.file.api.model.FileDescriptor;
import com.krishnamurti.horizon.file.api.model.FileLifecycle;
import com.krishnamurti.horizon.file.api.model.FileScope;
import com.krishnamurti.horizon.file.infrastructure.FileProperties;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.IllegalTransactionStateException;

@Import({TestcontainersConfiguration.class, FileApplicationTestConfiguration.class})
@SpringBootTest
class FilePrepareIntegrationTest {
    @Autowired private FileService files;
    @Autowired private TestFileOwner owner;
    @Autowired private RecordingObjectStorage storage;
    @Autowired private JdbcTemplate jdbc;
    @Autowired private FileProperties properties;

    @BeforeEach
    void clearTestStorage() {
        ensureUsers(jdbc);
        jdbc.update("update file_metadata set claimed_at = null, selected_attempt_id = null");
        jdbc.update("delete from file_transfer_attempt");
        jdbc.update("delete from file_metadata");
        storage.reset();
        properties.setMaxFileSize(org.springframework.util.unit.DataSize.ofBytes(20_971_519L));
    }

    @Test
    void sameRequestReturnsSameLogicalFile() {
        PrepareFileCommand command = command(UUID.randomUUID(), scope(71L, "note-a"), "chart.webp");

        var first = owner.prepare(command);
        var replay = owner.prepare(command);

        assertThat(replay.fileId()).isEqualTo(first.fileId());
        assertThat(replay.createdAt()).isEqualTo(first.createdAt());
        assertThat(jdbc.queryForObject("select count(*) from file_metadata", Long.class))
                .isEqualTo(1L);
    }

    @Test
    void incompatibleOwnerBindingOrMetadataConflictsWithoutDisclosure() {
        UUID key = UUID.randomUUID();
        owner.prepare(command(key, scope(71L, "note-a"), "chart.webp"));

        assertThatThrownBy(() -> owner.prepare(command(key, scope(72L, "note-a"), "chart.webp")))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("Conflicting file reservation");
        assertThatThrownBy(() -> owner.prepare(command(key, scope(71L, "note-b"), "chart.webp")))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("Conflicting file reservation");
        assertThatThrownBy(() -> owner.prepare(command(key, scope(71L, "note-a"), "other.webp")))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("Conflicting file reservation");
    }

    @Test
    void concurrentPrepareProducesOneRow() throws Exception {
        PrepareFileCommand command = command(UUID.randomUUID(), scope(73L, "note-a"), "chart.webp");
        CountDownLatch ready = new CountDownLatch(2);
        CountDownLatch start = new CountDownLatch(1);
        try (var executor = Executors.newFixedThreadPool(2)) {
            var first = executor.submit(() -> prepareAfterGate(command, ready, start));
            var second = executor.submit(() -> prepareAfterGate(command, ready, start));
            assertThat(ready.await(10, TimeUnit.SECONDS)).isTrue();
            start.countDown();
            assertThat(first.get(30, TimeUnit.SECONDS).fileId())
                    .isEqualTo(second.get(30, TimeUnit.SECONDS).fileId());
        }
        assertThat(jdbc.queryForObject("select count(*) from file_metadata", Long.class))
                .isEqualTo(1L);
    }

    @Test
    void prepareRequiresCallerTransaction() {
        PrepareFileCommand command = command(UUID.randomUUID(), scope(74L, "note-a"), "chart.webp");
        assertThatThrownBy(() -> files.prepare(command))
                .isInstanceOf(IllegalTransactionStateException.class);
        assertThat(jdbc.queryForObject("select count(*) from file_metadata", Long.class)).isZero();
    }

    @Test
    void expiredReplayDoesNotResurrectReservation() {
        UUID key = UUID.randomUUID();
        var prepared = owner.prepare(command(key, scope(75L, "note-a"), "chart.webp"));
        jdbc.update(
                "update file_metadata set created_at = now() - interval '2 seconds',"
                        + " expires_at = now() - interval '1 second' where id = ?",
                prepared.fileId());

        var replay = owner.prepare(command(key, scope(75L, "note-a"), "chart.webp"));

        assertThat(replay.fileId()).isEqualTo(prepared.fileId());
        assertThat(replay.lifecycle()).isEqualTo(FileLifecycle.EXPIRED);
    }

    @Test
    void inspectIsScopeCheckedAndDoesNotCallStorage() {
        var prepared =
                owner.prepare(command(UUID.randomUUID(), scope(76L, "note-a"), "chart.webp"));

        assertThat(
                        files.inspect(
                                        new com.krishnamurti.horizon.file.api.query
                                                .InspectFileQuery(
                                                new com.krishnamurti.horizon.file.api.model
                                                        .FileReference(
                                                        prepared.fileId(), scope(76L, "note-a"))))
                                .fileId())
                .isEqualTo(prepared.fileId());
        assertThatThrownBy(
                        () ->
                                files.inspect(
                                        new com.krishnamurti.horizon.file.api.query
                                                .InspectFileQuery(
                                                new com.krishnamurti.horizon.file.api.model
                                                        .FileReference(
                                                        prepared.fileId(), scope(76L, "note-b")))))
                .isInstanceOf(IllegalArgumentException.class);
        assertThat(storage.putCount()).isZero();
    }

    @Test
    void prepareRollbackLeavesNoReservation() {
        PrepareFileCommand command = command(UUID.randomUUID(), scope(77L, "note-a"), "chart.webp");

        assertThatThrownBy(
                        () ->
                                owner.inTransaction(
                                        () -> {
                                            var snapshot = files.prepare(command);
                                            throw new IllegalStateException(
                                                    snapshot.fileId().toString());
                                        }))
                .isInstanceOf(IllegalStateException.class);

        assertThat(jdbc.queryForObject("select count(*) from file_metadata", Long.class)).isZero();
    }

    @Test
    void reducedLimitDoesNotInvalidateHistoricalReplayButRejectsNewReservation() {
        UUID historicalKey = UUID.randomUUID();
        PrepareFileCommand historical = command(historicalKey, scope(78L, "note-a"), "chart.webp");
        var prepared = owner.prepare(historical);
        properties.setMaxFileSize(org.springframework.util.unit.DataSize.ofBytes(1));

        assertThat(owner.prepare(historical).fileId()).isEqualTo(prepared.fileId());
        assertThatThrownBy(
                        () ->
                                owner.prepare(
                                        command(
                                                UUID.randomUUID(),
                                                scope(78L, "note-a"),
                                                "chart.webp")))
                .isInstanceOf(IllegalArgumentException.class);
    }

    private com.krishnamurti.horizon.file.api.model.FileSnapshot prepareAfterGate(
            PrepareFileCommand command, CountDownLatch ready, CountDownLatch start)
            throws Exception {
        ready.countDown();
        assertThat(start.await(10, TimeUnit.SECONDS)).isTrue();
        return owner.prepare(command);
    }

    static PrepareFileCommand command(UUID key, FileScope scope, String filename) {
        byte[] bytes = "request fingerprint fixture".getBytes(StandardCharsets.UTF_8);
        try {
            String digest =
                    HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
            return new PrepareFileCommand(
                    key, scope, new FileDescriptor(filename, "image/webp", bytes.length, digest));
        } catch (java.security.NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    static FileScope scope(long userId, String binding) {
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

    static void ensureUsers(JdbcTemplate jdbc) {
        jdbc.update(
                """
                insert into users (id, email, password_hash, first_name, last_name, created_at,
                                   updated_at)
                select user_id, 'file-it-' || user_id || '@example.test', 'test-hash', 'File',
                       'Test', now(), now()
                from generate_series(71, 99) as user_id
                on conflict (id) do nothing
                """);
    }
}
