package com.krishnamurti.horizon.file.application;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.krishnamurti.horizon.TestcontainersConfiguration;
import com.krishnamurti.horizon.file.api.FileService;
import com.krishnamurti.horizon.file.api.command.ClaimFileCommand;
import com.krishnamurti.horizon.file.api.command.CleanupFileCommand;
import com.krishnamurti.horizon.file.api.command.PrepareFileCommand;
import com.krishnamurti.horizon.file.api.command.TransferFileCommand;
import com.krishnamurti.horizon.file.api.model.ClaimResult;
import com.krishnamurti.horizon.file.api.model.FileDescriptor;
import com.krishnamurti.horizon.file.api.model.FileReference;
import com.krishnamurti.horizon.file.api.model.FileScope;
import com.krishnamurti.horizon.file.api.model.TransferDisposition;
import com.krishnamurti.horizon.file.api.query.ReadFileQuery;
import com.krishnamurti.horizon.file.infrastructure.FileProperties;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.IllegalTransactionStateException;
import org.springframework.transaction.support.TransactionSynchronizationManager;

@Import({TestcontainersConfiguration.class, FileApplicationTestConfiguration.class})
@SpringBootTest
class FileOwnershipIntegrationTest {
    private static final byte[] VALID_WEBP = fixture("file/fixtures/static.webp");

    @Autowired private FileService files;
    @Autowired private TestFileOwner owner;
    @Autowired private RecordingObjectStorage storage;
    @Autowired private JdbcTemplate jdbc;
    @Autowired private FileProperties properties;

    @BeforeEach
    void resetFixture() {
        FilePrepareIntegrationTest.ensureUsers(jdbc);
        jdbc.execute(
                """
                create table if not exists test_file_association (
                    file_id uuid primary key references file_metadata(id) on delete restrict,
                    user_id bigint not null references users(id) on delete restrict
                )
                """);
        jdbc.update("delete from test_file_association");
        jdbc.update("update file_metadata set claimed_at = null, selected_attempt_id = null");
        jdbc.update("delete from file_transfer_attempt");
        jdbc.update("delete from file_metadata");
        storage.reset();
        properties.setMaxFileSize(org.springframework.util.unit.DataSize.ofBytes(20_971_519L));
    }

    @AfterEach
    void clearCallerAssociations() {
        jdbc.update("delete from test_file_association");
    }

    @Test
    void prepareTransferClaimReadRoundTrip() throws Exception {
        FileScope scope = scope(94L, "note-94");
        FileReference reference = verifiedFile(scope);
        assertThatThrownBy(() -> files.openRead(new ReadFileQuery(reference)))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("File content is not available");
        assertThat(storage.getCount()).isZero();

        assertThat(owner.inTransaction(() -> files.claim(new ClaimFileCommand(reference))))
                .isEqualTo(ClaimResult.CLAIMED);
        assertThat(owner.inTransaction(() -> files.claim(new ClaimFileCommand(reference))))
                .isEqualTo(ClaimResult.ALREADY_CLAIMED);

        var content = files.openRead(new ReadFileQuery(reference));
        assertThat(content.metadata().declaredContentType()).isEqualTo("image/webp");
        assertThat(content.stream().readAllBytes()).containsExactly(VALID_WEBP);
        content.close();
        content.close();
        assertThat(storage.getCount()).isEqualTo(1);
        assertThat(storage.closedReadStreamCount()).isEqualTo(1);
    }

    @Test
    void unverifiedExpiredUnclaimedAndWrongScopeCannotRead() {
        FileScope scope = scope(95L, "note-95");
        FileReference prepared = preparedFile(scope);
        assertThatThrownBy(() -> files.openRead(new ReadFileQuery(prepared)))
                .isInstanceOf(IllegalStateException.class);
        assertThatThrownBy(
                        () ->
                                files.openRead(
                                        new ReadFileQuery(
                                                new FileReference(
                                                        prepared.fileId(),
                                                        scope(95L, "wrong-owner-binding")))))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("File not found");
        assertThat(storage.getCount()).isZero();

        FileScope verifiedScope = scope(96L, "note-96");
        FileReference verified = verifiedFile(verifiedScope);
        assertThatThrownBy(() -> files.openRead(new ReadFileQuery(verified)))
                .isInstanceOf(IllegalStateException.class);
        jdbc.update("update file_metadata set expires_at = now() where id = ?", verified.fileId());
        assertThatThrownBy(
                        () ->
                                owner.inTransaction(
                                        () -> files.claim(new ClaimFileCommand(verified))))
                .isInstanceOf(IllegalStateException.class);
        assertThat(storage.getCount()).isZero();
    }

    @Test
    void concurrentClaimHasOneWinnerAndOnlyWinnerCanCreateAssociation() throws Exception {
        FileScope scope = scope(97L, "note-97");
        FileReference reference = verifiedFile(scope);
        CountDownLatch ready = new CountDownLatch(2);
        CountDownLatch start = new CountDownLatch(1);
        try (var executor = Executors.newFixedThreadPool(2)) {
            var first = executor.submit(() -> claimAndAssociate(reference, ready, start));
            var second = executor.submit(() -> claimAndAssociate(reference, ready, start));
            assertThat(ready.await(10, TimeUnit.SECONDS)).isTrue();
            start.countDown();
            assertThat(first.get(30, TimeUnit.SECONDS))
                    .isNotEqualTo(second.get(30, TimeUnit.SECONDS));
        }
        assertThat(jdbc.queryForObject("select count(*) from test_file_association", Long.class))
                .isEqualTo(1L);
        assertThat(storage.getCount()).isZero();
    }

    @Test
    void claimAndCallerAssociationRollbackTogether() {
        FileScope scope = scope(98L, "note-98");
        FileReference reference = verifiedFile(scope);

        assertThatThrownBy(
                        () ->
                                owner.inTransaction(
                                        () -> {
                                            assertThat(files.claim(new ClaimFileCommand(reference)))
                                                    .isEqualTo(ClaimResult.CLAIMED);
                                            jdbc.update(
                                                    "insert into test_file_association(file_id,"
                                                            + " user_id) values (?, ?)",
                                                    reference.fileId(),
                                                    scope.userId());
                                            throw new IllegalStateException("rollback association");
                                        }))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("rollback association");
        assertThat(claimed(reference.fileId())).isFalse();
        assertThat(jdbc.queryForObject("select count(*) from test_file_association", Long.class))
                .isZero();

        owner.inTransaction(
                () -> {
                    assertThat(files.claim(new ClaimFileCommand(reference)))
                            .isEqualTo(ClaimResult.CLAIMED);
                    jdbc.update(
                            "insert into test_file_association(file_id, user_id) values (?, ?)",
                            reference.fileId(),
                            scope.userId());
                    return null;
                });
        assertThat(claimed(reference.fileId())).isTrue();
        assertThat(jdbc.queryForObject("select count(*) from test_file_association", Long.class))
                .isEqualTo(1L);
    }

    @Test
    void cleanupAndCallerDetachRollbackTogether() {
        FileScope scope = scope(99L, "note-99");
        FileReference reference = verifiedFile(scope);
        owner.inTransaction(
                () -> {
                    files.claim(new ClaimFileCommand(reference));
                    jdbc.update(
                            "insert into test_file_association(file_id, user_id) values (?, ?)",
                            reference.fileId(),
                            scope.userId());
                    return null;
                });

        assertThatThrownBy(
                        () ->
                                owner.inTransaction(
                                        () -> {
                                            files.requestCleanup(new CleanupFileCommand(reference));
                                            jdbc.update(
                                                    "delete from test_file_association where"
                                                            + " file_id = ?",
                                                    reference.fileId());
                                            throw new IllegalStateException("rollback detach");
                                        }))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("rollback detach");
        assertThat(cleanupRequested(reference.fileId())).isFalse();
        assertThat(jdbc.queryForObject("select count(*) from test_file_association", Long.class))
                .isEqualTo(1L);

        owner.inTransaction(
                () -> {
                    files.requestCleanup(new CleanupFileCommand(reference));
                    jdbc.update(
                            "delete from test_file_association where file_id = ?",
                            reference.fileId());
                    return null;
                });
        assertThat(cleanupRequested(reference.fileId())).isTrue();
        assertThat(jdbc.queryForObject("select count(*) from test_file_association", Long.class))
                .isZero();
        assertThatThrownBy(() -> files.openRead(new ReadFileQuery(reference)))
                .isInstanceOf(IllegalStateException.class);
        assertThat(storage.getCount()).isZero();
    }

    @Test
    void cleanupIsIdempotentDoesNotSynchronouslyDeleteAndBlocksNewReads() throws Exception {
        FileScope scope = scope(94L, "cleanup-idempotent");
        FileReference reference = verifiedFile(scope);
        owner.inTransaction(() -> files.claim(new ClaimFileCommand(reference)));
        var content = files.openRead(new ReadFileQuery(reference));
        assertThat(storage.getCount()).isEqualTo(1);

        owner.inTransaction(
                () -> {
                    files.requestCleanup(new CleanupFileCommand(reference));
                    return null;
                });
        var first = cleanupTimestamp(reference.fileId());
        owner.inTransaction(
                () -> {
                    files.requestCleanup(new CleanupFileCommand(reference));
                    return null;
                });
        assertThat(cleanupTimestamp(reference.fileId())).isEqualTo(first);
        assertThat(storage.head(storageKey(reference.fileId())).found()).isTrue();
        assertThatThrownBy(() -> files.openRead(new ReadFileQuery(reference)))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("File content is not available");
        assertThat(storage.getCount()).isEqualTo(1);

        assertThat(content.stream().readAllBytes()).containsExactly(VALID_WEBP);
        content.close();
        assertThat(storage.closedReadStreamCount()).isEqualTo(1);
    }

    @Test
    void claimAndCleanupRequireCallerTransactionAndReadRequiresNoTransaction() {
        FileReference reference = preparedFile(scope(95L, "tx-boundaries"));
        assertThatThrownBy(() -> files.claim(new ClaimFileCommand(reference)))
                .isInstanceOf(IllegalTransactionStateException.class);
        assertThatThrownBy(() -> files.requestCleanup(new CleanupFileCommand(reference)))
                .isInstanceOf(IllegalTransactionStateException.class);
        assertThatThrownBy(
                        () ->
                                owner.inTransaction(
                                        () -> files.openRead(new ReadFileQuery(reference))))
                .isInstanceOf(IllegalTransactionStateException.class);
        assertThat(TransactionSynchronizationManager.isActualTransactionActive()).isFalse();
        assertThat(storage.getCount()).isZero();
    }

    @Test
    void claimedHistoricalFileRemainsReadableAfterEffectiveLimitReduction() throws Exception {
        FileScope scope = scope(96L, "historical-file");
        FileReference reference = verifiedFile(scope);
        owner.inTransaction(() -> files.claim(new ClaimFileCommand(reference)));
        properties.setMaxFileSize(org.springframework.util.unit.DataSize.ofBytes(1));

        try (var content = files.openRead(new ReadFileQuery(reference))) {
            assertThat(content.stream().readAllBytes()).containsExactly(VALID_WEBP);
        }
        assertThat(storage.getCount()).isEqualTo(1);
    }

    private ClaimResult claimAndAssociate(
            FileReference reference, CountDownLatch ready, CountDownLatch start) throws Exception {
        ready.countDown();
        assertThat(start.await(10, TimeUnit.SECONDS)).isTrue();
        return owner.inTransaction(
                () -> {
                    ClaimResult result = files.claim(new ClaimFileCommand(reference));
                    if (result == ClaimResult.CLAIMED) {
                        jdbc.update(
                                "insert into test_file_association(file_id, user_id) values (?, ?)",
                                reference.fileId(),
                                reference.scope().userId());
                    }
                    return result;
                });
    }

    private FileReference verifiedFile(FileScope scope) {
        FileReference reference = preparedFile(scope);
        var result =
                files.transfer(
                        new TransferFileCommand(
                                reference,
                                VALID_WEBP.length,
                                new ByteArrayInputStream(VALID_WEBP)));
        assertThat(result.disposition()).isEqualTo(TransferDisposition.VERIFIED);
        storage.resetReadTracking();
        return reference;
    }

    private FileReference preparedFile(FileScope scope) {
        String digest = sha256(VALID_WEBP);
        var prepared =
                owner.prepare(
                        new PrepareFileCommand(
                                UUID.randomUUID(),
                                scope,
                                new FileDescriptor(
                                        "chart.webp", "image/webp", VALID_WEBP.length, digest)));
        return new FileReference(prepared.fileId(), scope);
    }

    private boolean claimed(UUID fileId) {
        return jdbc.queryForObject(
                "select claimed_at is not null from file_metadata where id = ?",
                Boolean.class,
                fileId);
    }

    private boolean cleanupRequested(UUID fileId) {
        return jdbc.queryForObject(
                "select cleanup_requested_at is not null from file_metadata where id = ?",
                Boolean.class,
                fileId);
    }

    private java.time.Instant cleanupTimestamp(UUID fileId) {
        return jdbc.queryForObject(
                        "select cleanup_requested_at from file_metadata where id = ?",
                        java.sql.Timestamp.class,
                        fileId)
                .toInstant();
    }

    private com.krishnamurti.horizon.file.application.port.ObjectKey storageKey(UUID fileId) {
        String key =
                jdbc.queryForObject(
                        "select object_key from file_transfer_attempt where file_id = ?",
                        String.class,
                        fileId);
        return new com.krishnamurti.horizon.file.application.port.ObjectKey(key);
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

    private static byte[] fixture(String path) {
        try (InputStream input =
                FileOwnershipIntegrationTest.class.getClassLoader().getResourceAsStream(path)) {
            if (input == null) throw new IllegalStateException("Missing fixture: " + path);
            return input.readAllBytes();
        } catch (IOException e) {
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
}
