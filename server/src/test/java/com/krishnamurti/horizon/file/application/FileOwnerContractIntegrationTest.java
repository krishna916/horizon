package com.krishnamurti.horizon.file.application;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.krishnamurti.horizon.TestcontainersConfiguration;
import com.krishnamurti.horizon.file.api.FileOperationException;
import com.krishnamurti.horizon.file.api.FileService;
import com.krishnamurti.horizon.file.api.command.ClaimFileCommand;
import com.krishnamurti.horizon.file.api.command.CleanupFileCommand;
import com.krishnamurti.horizon.file.api.command.PrepareFileCommand;
import com.krishnamurti.horizon.file.api.command.TransferFileCommand;
import com.krishnamurti.horizon.file.api.model.FileDescriptor;
import com.krishnamurti.horizon.file.api.model.FileReference;
import com.krishnamurti.horizon.file.api.model.FileScope;
import com.krishnamurti.horizon.file.api.model.TransferDisposition;
import com.krishnamurti.horizon.file.api.query.ReadFileQuery;
import com.krishnamurti.horizon.file.application.port.ObjectKey;
import com.krishnamurti.horizon.file.application.port.WriteResult;
import com.krishnamurti.horizon.file.domain.TransferOutcome;
import com.krishnamurti.horizon.file.infrastructure.persistence.FileTransferAttemptRepository;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;

@Import({TestcontainersConfiguration.class, FileApplicationTestConfiguration.class})
@SpringBootTest
class FileOwnerContractIntegrationTest {
    private static final byte[] CONTENT = fixture("file/fixtures/static.webp");
    private static final long USER_ID = 94L;

    @Autowired private FileService files;
    @Autowired private TestFileOwner owner;
    @Autowired private RecordingObjectStorage storage;
    @Autowired private FileRecoveryWorker worker;
    @Autowired private FileTransferAttemptRepository attempts;
    @Autowired private JdbcTemplate jdbc;

    @BeforeEach
    void reset() {
        FilePrepareIntegrationTest.ensureUsers(jdbc);
        jdbc.execute(
                "create table if not exists test_file_parent (id uuid primary key, user_id bigint"
                    + " not null, workspace text not null, binding text not null, version bigint"
                    + " not null, lifecycle text not null)");
        jdbc.execute(
                "create table if not exists test_file_parent_file ("
                        + "parent_id uuid not null references test_file_parent(id),"
                        + " file_id uuid not null references file_metadata(id),"
                        + " primary key(parent_id,file_id), unique(file_id))");
        jdbc.execute(
                "create table if not exists test_file_parent_pending_file ("
                        + "parent_id uuid not null references test_file_parent(id),"
                        + " file_id uuid not null references file_metadata(id),"
                        + " primary key(parent_id,file_id), unique(file_id))");
        jdbc.update("delete from test_file_parent_pending_file");
        jdbc.update("delete from test_file_parent_file");
        jdbc.update("delete from test_file_parent");
        jdbc.update("update file_metadata set selected_attempt_id=null, claimed_at=null");
        jdbc.update("delete from file_transfer_attempt");
        jdbc.update("delete from file_metadata");
        storage.reset();
    }

    @Test
    void permanentParentRemovalIsAtomicAndRetainsUnknownAttemptLocator() {
        UUID parent = createParent(USER_ID, "parent-a");
        FileScope scope = scope(USER_ID, "parent-a");
        FileReference first = verifiedClaimed(scope, "first.webp");
        FileReference second = verifiedClaimed(scope, "second.webp");
        UUID unrelatedParent = createParent(USER_ID, "unrelated");
        FileReference unrelated = verifiedClaimed(scope(USER_ID, "unrelated"), "unrelated.webp");
        UUID unknownId = prepare(scope, "pending.webp");
        storage.nextPutResult(WriteResult.UNKNOWN);
        assertThat(
                        files.transfer(
                                        new TransferFileCommand(
                                                new FileReference(unknownId, scope),
                                                CONTENT.length,
                                                new ByteArrayInputStream(CONTENT)))
                                .disposition())
                .isEqualTo(TransferDisposition.OUTCOME_UNKNOWN);
        String unknownKey =
                attempts.findAllByFileIdOrderByCreatedAtAsc(unknownId).getFirst().getObjectKey();

        associate(parent, first.fileId());
        associate(parent, second.fileId());
        jdbc.update(
                "insert into test_file_parent_pending_file(parent_id,file_id) values (?,?)",
                parent,
                unknownId);
        associate(unrelatedParent, unrelated.fileId());
        assertThat(attempts.findAllByFileIdOrderByCreatedAtAsc(unknownId).getFirst().getOutcome())
                .isEqualTo(TransferOutcome.UNKNOWN);

        for (FileScope invalidScope :
                List.of(
                        scope(USER_ID + 1, "parent-a"),
                        scope(USER_ID, "wrong-workspace"),
                        new FileScope(USER_ID, "parent-a", "b".repeat(64)))) {
            assertThatThrownBy(
                            () ->
                                    owner.inTransaction(
                                            () -> {
                                                files.requestCleanup(
                                                        new CleanupFileCommand(
                                                                new FileReference(
                                                                        first.fileId(),
                                                                        invalidScope)));
                                                return null;
                                            }))
                    .isInstanceOf(FileOperationException.class);
        }
        assertThat(cleanupRequested(first.fileId())).isFalse();

        List<UUID> filesToRemove =
                List.of(first.fileId(), second.fileId(), unknownId).stream().sorted().toList();
        assertThatThrownBy(
                        () ->
                                owner.inTransaction(
                                        () -> {
                                            filesToRemove.forEach(
                                                    fileId ->
                                                            files.requestCleanup(
                                                                    new CleanupFileCommand(
                                                                            new FileReference(
                                                                                    fileId,
                                                                                    scope))));
                                            jdbc.update(
                                                    "delete from test_file_parent_file where"
                                                            + " parent_id=?",
                                                    parent);
                                            jdbc.update(
                                                    "delete from test_file_parent_pending_file"
                                                            + " where parent_id=?",
                                                    parent);
                                            jdbc.update(
                                                    "update test_file_parent set version=version+1,"
                                                            + " lifecycle='REMOVED' where id=?",
                                                    parent);
                                            throw new IllegalStateException(
                                                    "injected parent rollback");
                                        }))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("injected parent rollback");
        assertParent(parent, 0, "ACTIVE");
        assertThat(
                        jdbc.queryForObject(
                                "select count(*) from test_file_parent_file where parent_id=?",
                                Long.class,
                                parent))
                .isEqualTo(2L);
        assertThat(
                        jdbc.queryForObject(
                                "select count(*) from test_file_parent_pending_file where"
                                        + " parent_id=?",
                                Long.class,
                                parent))
                .isEqualTo(1L);
        assertThat(filesToRemove)
                .allSatisfy(fileId -> assertThat(cleanupRequested(fileId)).isFalse());
        worker.runCycle();
        assertThat(storage.deleteCount()).isZero();
        read(first);
        read(second);

        owner.inTransaction(
                () -> {
                    filesToRemove.forEach(
                            fileId ->
                                    files.requestCleanup(
                                            new CleanupFileCommand(
                                                    new FileReference(fileId, scope))));
                    jdbc.update("delete from test_file_parent_file where parent_id=?", parent);
                    jdbc.update(
                            "delete from test_file_parent_pending_file where parent_id=?", parent);
                    jdbc.update(
                            "update test_file_parent set version=version+1,lifecycle='REMOVED'"
                                    + " where id=? and version=0",
                            parent);
                    return null;
                });
        assertParent(parent, 1, "REMOVED");
        assertThat(cleanupRequested(first.fileId())).isTrue();
        assertThat(cleanupRequested(second.fileId())).isTrue();
        assertThat(cleanupRequested(unknownId)).isTrue();
        assertThatThrownBy(() -> files.openRead(new ReadFileQuery(first)))
                .isInstanceOf(FileOperationException.class);
        worker.runCycle();

        var firstAttempt = attempts.findAllByFileIdOrderByCreatedAtAsc(first.fileId()).getFirst();
        var secondAttempt = attempts.findAllByFileIdOrderByCreatedAtAsc(second.fileId()).getFirst();
        var unknownAttempt = attempts.findAllByFileIdOrderByCreatedAtAsc(unknownId).getFirst();
        assertThat(firstAttempt.getCleanupConfirmedAt()).isNotNull();
        assertThat(firstAttempt.getObjectKey()).isNull();
        assertThat(secondAttempt.getCleanupConfirmedAt()).isNotNull();
        assertThat(secondAttempt.getObjectKey()).isNull();
        assertThat(unknownAttempt.getOutcome()).isEqualTo(TransferOutcome.UNKNOWN);
        assertThat(unknownAttempt.getObjectKey()).isEqualTo(unknownKey);
        assertThat(unknownAttempt.getCleanupConfirmedAt()).isNull();
        assertThat(storage.head(new ObjectKey(unknownKey)).found()).isFalse();
        read(unrelated);
        assertThat(cleanupRequested(unrelated.fileId())).isFalse();
    }

    @Test
    void finalizeReplayAndArchiveTrashSurrogatePreserveVersionAndBytes() {
        UUID parent = createParent(USER_ID, "lifecycle");
        FileScope scope = scope(USER_ID, "lifecycle");
        FileReference reference = verifiedFile(scope, "lifecycle.webp");

        assertThatThrownBy(() -> finalizeClaim(parent, reference, 1))
                .isInstanceOf(IllegalStateException.class);
        assertParent(parent, 0, "ACTIVE");
        assertThat(associated(reference.fileId())).isFalse();
        assertThatThrownBy(
                        () ->
                                owner.inTransaction(
                                        () -> {
                                            files.claim(new ClaimFileCommand(reference));
                                            throw new IllegalStateException("finalize rollback");
                                        }))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("finalize rollback");
        assertParent(parent, 0, "ACTIVE");
        assertThat(associated(reference.fileId())).isFalse();

        finalizeClaim(parent, reference, 0);
        assertParent(parent, 1, "ACTIVE");
        assertThat(associated(reference.fileId())).isTrue();
        finalizeClaim(parent, reference, 1);
        assertParent(parent, 1, "ACTIVE");

        jdbc.update("update test_file_parent set lifecycle='ARCHIVED' where id=?", parent);
        worker.runCycle();
        read(reference);
        assertThat(cleanupRequested(reference.fileId())).isFalse();
        jdbc.update(
                "update test_file_parent set lifecycle='TRASHED',version=version+1 where id=?",
                parent);
        worker.runCycle();
        read(reference);
        assertThat(cleanupRequested(reference.fileId())).isFalse();
        jdbc.update("update test_file_parent set lifecycle='ACTIVE' where id=?", parent);
        read(reference);

        assertThatThrownBy(
                        () ->
                                owner.inTransaction(
                                        () -> {
                                            files.requestCleanup(new CleanupFileCommand(reference));
                                            jdbc.update(
                                                    "delete from test_file_parent_file where"
                                                            + " parent_id=? and file_id=?",
                                                    parent,
                                                    reference.fileId());
                                            throw new IllegalStateException("detach rollback");
                                        }))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("detach rollback");
        assertThat(associated(reference.fileId())).isTrue();
        assertThat(cleanupRequested(reference.fileId())).isFalse();
        read(reference);

        owner.inTransaction(
                () -> {
                    files.requestCleanup(new CleanupFileCommand(reference));
                    jdbc.update(
                            "delete from test_file_parent_file where parent_id=? and file_id=?",
                            parent,
                            reference.fileId());
                    jdbc.update("update test_file_parent set version=version+1 where id=?", parent);
                    return null;
                });
        assertThat(associated(reference.fileId())).isFalse();
        worker.runCycle();
        var attempt = attempts.findAllByFileIdOrderByCreatedAtAsc(reference.fileId()).getFirst();
        assertThat(attempt.getCleanupConfirmedAt()).isNotNull();
        assertThat(attempt.getObjectKey()).isNull();
    }

    private void finalizeClaim(UUID parent, FileReference reference, long expectedVersion) {
        owner.inTransaction(
                () -> {
                    long current =
                            jdbc.queryForObject(
                                    "select version from test_file_parent where id=?",
                                    Long.class,
                                    parent);
                    if (current != expectedVersion)
                        throw new IllegalStateException("stale version");
                    if (associated(reference.fileId())) return null;
                    files.claim(new ClaimFileCommand(reference));
                    associate(parent, reference.fileId());
                    jdbc.update("update test_file_parent set version=version+1 where id=?", parent);
                    return null;
                });
    }

    private FileReference verifiedClaimed(FileScope scope, String name) {
        FileReference reference = verifiedFile(scope, name);
        owner.inTransaction(() -> files.claim(new ClaimFileCommand(reference)));
        return reference;
    }

    private FileReference verifiedFile(FileScope scope, String name) {
        UUID id = prepare(scope, name);
        FileReference reference = new FileReference(id, scope);
        assertThat(
                        files.transfer(
                                        new TransferFileCommand(
                                                reference,
                                                CONTENT.length,
                                                new ByteArrayInputStream(CONTENT)))
                                .disposition())
                .isEqualTo(TransferDisposition.VERIFIED);
        return reference;
    }

    private UUID prepare(FileScope scope, String name) {
        try {
            var descriptor =
                    new FileDescriptor(name, "image/webp", CONTENT.length, sha256(CONTENT));
            return owner.prepare(new PrepareFileCommand(UUID.randomUUID(), scope, descriptor))
                    .fileId();
        } catch (Exception exception) {
            throw new IllegalStateException(exception);
        }
    }

    private UUID createParent(long userId, String workspace) {
        UUID id = UUID.randomUUID();
        jdbc.update(
                "insert into test_file_parent(id,user_id,workspace,binding,version,lifecycle)"
                        + " values (?,?,?,?,0,'ACTIVE')",
                id,
                userId,
                workspace,
                "a".repeat(64));
        return id;
    }

    private void associate(UUID parent, UUID fileId) {
        jdbc.update(
                "insert into test_file_parent_file(parent_id,file_id) values (?,?)",
                parent,
                fileId);
    }

    private boolean associated(UUID fileId) {
        return Boolean.TRUE.equals(
                jdbc.queryForObject(
                        "select exists(select 1 from test_file_parent_file where file_id=?)",
                        Boolean.class,
                        fileId));
    }

    private boolean cleanupRequested(UUID fileId) {
        return Boolean.TRUE.equals(
                jdbc.queryForObject(
                        "select cleanup_requested_at is not null from file_metadata where id=?",
                        Boolean.class,
                        fileId));
    }

    private void assertParent(UUID id, long version, String lifecycle) {
        assertThat(
                        jdbc.queryForObject(
                                "select version from test_file_parent where id=?", Long.class, id))
                .isEqualTo(version);
        assertThat(
                        jdbc.queryForObject(
                                "select lifecycle from test_file_parent where id=?",
                                String.class,
                                id))
                .isEqualTo(lifecycle);
    }

    private void read(FileReference reference) {
        try (var content = files.openRead(new ReadFileQuery(reference))) {
            assertThat(content.stream().readAllBytes()).containsExactly(CONTENT);
        } catch (Exception exception) {
            throw new AssertionError(
                    "expected associated File bytes to remain readable", exception);
        }
    }

    private static FileScope scope(long userId, String workspace) {
        return new FileScope(userId, workspace, "a".repeat(64));
    }

    private static String sha256(byte[] bytes) throws Exception {
        return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
    }

    private static byte[] fixture(String resource) {
        try (var input =
                FileOwnerContractIntegrationTest.class
                        .getClassLoader()
                        .getResourceAsStream(resource)) {
            if (input == null) throw new IllegalStateException("Missing fixture " + resource);
            return input.readAllBytes();
        } catch (IOException exception) {
            throw new java.io.UncheckedIOException(exception);
        }
    }
}
