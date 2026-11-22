package com.krishnamurti.horizon.poc.s3;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.net.ServerSocket;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Duration;
import java.time.Instant;
import java.util.HexFormat;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestInstance;
import org.testcontainers.utility.DockerImageName;
import org.testcontainers.postgresql.PostgreSQLContainer;
import org.postgresql.ds.PGSimpleDataSource;
import software.amazon.awssdk.core.sync.RequestBody;
import software.amazon.awssdk.services.s3.model.GetObjectRequest;
import software.amazon.awssdk.services.s3.model.PutObjectRequest;
import software.amazon.awssdk.services.s3.model.S3Exception;

/** Disposable PostgreSQL + SeaweedFS model for the Issue #75 B01–B10 invariants. */
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class RecoveryProtocolTest {

    private static final DockerImageName POSTGRES_IMAGE = DockerImageName.parse(
            "postgres:17@sha256:9d4105e2fcb1308961d4ee01f0ebc14fdd0497b11243982a4a0935fdb1a8f8dc").asCompatibleSubstituteFor("postgres");

    private final PostgreSQLContainer postgres = new PostgreSQLContainer(POSTGRES_IMAGE)
            .withDatabaseName("issue75_poc")
            .withUsername("issue75_poc")
            .withPassword("issue75_poc_test_only");
    private S3Environment s3;
    private PGSimpleDataSource dataSource;
    private RecoveryCoordinator coordinator;
    private UUID ownerId;
    private UUID noteId;

    @BeforeAll
    void startDependencies() throws Exception {
        java.util.TimeZone.setDefault(java.util.TimeZone.getTimeZone("UTC"));
        postgres.start();
        dataSource = new PGSimpleDataSource();
        dataSource.setURL(postgres.getJdbcUrl());
        dataSource.setUser(postgres.getUsername());
        dataSource.setPassword(postgres.getPassword());
        s3 = S3Environment.start();
        coordinator = new RecoveryCoordinator(dataSource, s3.bucket());
        coordinator.initialize();
    }

    @BeforeEach
    void resetModel() throws Exception {
        coordinator.reset();
        ownerId = UUID.randomUUID();
        noteId = UUID.randomUUID();
        coordinator.createNote(noteId, ownerId, 0);
    }

    @AfterAll
    void stopDependencies() {
        if (s3 != null) s3.close();
        postgres.stop();
    }

    @Test
    void B01_intentIsDurableAndRecoverableAfterCoordinatorRecreation() throws Exception {
        RecoveryCoordinator.IntentRequest request = request(UUID.randomUUID(), noteId, "attachment", bytes("B01"));
        RecoveryCoordinator.PreparedIntent prepared = coordinator.prepare(request);

        RecoveryCoordinator restarted = new RecoveryCoordinator(dataSource, s3.bucket());
        RecoveryCoordinator.IntentSnapshot recovered = restarted.inspect(request.requestId());
        assertEquals("PREPARED", recovered.state());
        assertEquals(prepared.fileId(), recovered.fileId());
        assertEquals(prepared.attemptId(), recovered.attemptId());
        assertEquals(prepared.objectKey(), recovered.objectKey());
        assertFalse(restarted.isAttached(request.requestId()));
        ProofEvidence.record(s3.runId(), "B01", "PostgreSQL intent and attempt survived coordinator reconstruction before any PUT; state=PREPARED");
    }

    @Test
    void B02_s3CommitThenDatabaseFailureRemainsTrackedButNeverAttached() throws Exception {
        byte[] payload = bytes("B02-database-failure");
        RecoveryCoordinator.IntentRequest request = request(UUID.randomUUID(), noteId, "attachment", payload);
        RecoveryCoordinator.PreparedIntent prepared = coordinator.prepare(request);
        s3.directClient().putObject(PutObjectRequest.builder().bucket(s3.bucket()).key(prepared.objectKey()).build(), RequestBody.fromBytes(payload));

        assertThrows(RecoveryCoordinator.InjectedDatabaseFailure.class,
                () -> coordinator.recordUploadSuccess(request.requestId(), true));
        assertEquals("UPLOADING", coordinator.attemptState(request.requestId()));
        assertFalse(coordinator.isAttached(request.requestId()));
        assertEquals(RecoveryCoordinator.ReconcileOutcome.UPLOADED,
                coordinator.reconcileAttempt(request.requestId(), s3.directClient()));
        assertEquals("UPLOADED", coordinator.inspect(request.requestId()).state());
        assertFalse(coordinator.isAttached(request.requestId()));
        coordinator.tombstone(request.requestId());
        assertTrue(coordinator.cleanupKnownAttempt(request.requestId(), s3.directClient()));
        assertAbsent(prepared.objectKey());
        ProofEvidence.record(s3.runId(), "B02", "S3 PUT committed; injected PostgreSQL rollback left the durable attempt locator; direct reconciliation verified checksum, never attached, then cleanup deleted it");
    }

    @Test
    void B03_identicalIdempotencyRetryReturnsTheSameFileAndAttempt() throws Exception {
        UUID requestId = UUID.randomUUID();
        byte[] payload = bytes("B03-repeat");
        RecoveryCoordinator.PreparedIntent first = coordinator.prepare(request(requestId, noteId, "attachment", payload));
        RecoveryCoordinator.PreparedIntent retry = coordinator.prepare(request(requestId, noteId, "attachment", payload));

        assertEquals(first, retry);
        assertEquals(1, coordinator.attemptCount(requestId));
        ProofEvidence.record(s3.runId(), "B03", "same request UUID/content/Note/role returned the same file ID, attempt ID, physical key, and one durable attempt");
    }

    @Test
    void B04_requestFingerprintMismatchAndTerminalIntentCannotResurrect() throws Exception {
        UUID requestId = UUID.randomUUID();
        byte[] payload = bytes("B04-original");
        RecoveryCoordinator.IntentRequest original = request(requestId, noteId, "attachment", payload);
        coordinator.prepare(original);
        assertThrows(RecoveryCoordinator.ConflictException.class,
                () -> coordinator.prepare(request(requestId, noteId, "inline-image", payload)));
        assertThrows(RecoveryCoordinator.ConflictException.class,
                () -> coordinator.prepare(request(requestId, UUID.randomUUID(), "attachment", payload)));
        assertThrows(RecoveryCoordinator.ConflictException.class,
                () -> coordinator.prepare(request(requestId, noteId, "attachment", bytes("B04-other-content"))));
        assertThrows(RecoveryCoordinator.ConflictException.class,
                () -> coordinator.prepare(request(requestId, noteId, "attachment", new byte[0])));
        coordinator.expireIntent(requestId);
        assertThrows(RecoveryCoordinator.ConflictException.class, () -> coordinator.prepare(original));
        assertEquals("TOMBSTONED", coordinator.inspect(requestId).state());
        ProofEvidence.record(s3.runId(), "B04", "changed Note, role, length, or checksum conflicted; expired request remained tombstoned and could not be recreated");
    }

    @Test
    void B05_staleNoteVersionRejectsFinalizeButRetainsUploadedBytesForRetry() throws Exception {
        byte[] payload = bytes("B05-version-conflict");
        RecoveryCoordinator.IntentRequest request = request(UUID.randomUUID(), noteId, "inline-image", payload);
        RecoveryCoordinator.PreparedIntent prepared = coordinator.prepare(request);
        s3.directClient().putObject(PutObjectRequest.builder().bucket(s3.bucket()).key(prepared.objectKey()).build(), RequestBody.fromBytes(payload));
        coordinator.recordUploadSuccess(request.requestId(), false);
        coordinator.incrementNoteVersion(noteId);

        assertThrows(RecoveryCoordinator.StaleNoteVersionException.class,
                () -> coordinator.finalizeUpload(request.requestId(), false));
        assertEquals("UPLOADED", coordinator.inspect(request.requestId()).state());
        assertFalse(coordinator.isAttached(request.requestId()));
        coordinator.refreshExpectedNoteVersion(request.requestId());
        RecoveryCoordinator.FinalizationResult retried = coordinator.finalizeUpload(request.requestId(), false);
        assertEquals("CLAIMED", coordinator.inspect(request.requestId()).state());
        assertEquals(2, retried.noteVersion());
        assertArrayEquals(payload, s3.directClient().getObjectAsBytes(
                GetObjectRequest.builder().bucket(s3.bucket()).key(prepared.objectKey()).build()).asByteArray());
        ProofEvidence.record(s3.runId(), "B05", "stale expected Note version rejected finalization; staged S3 bytes remained and a version-refresh retry finalized without another PUT");
    }

    @Test
    void B06_competingParentClaimsHaveExactlyOneWinner() throws Exception {
        byte[] payload = bytes("B06-exclusive-claim");
        RecoveryCoordinator.IntentRequest request = request(UUID.randomUUID(), noteId, "attachment", payload);
        RecoveryCoordinator.PreparedIntent prepared = coordinator.prepare(request);
        s3.directClient().putObject(PutObjectRequest.builder().bucket(s3.bucket()).key(prepared.objectKey()).build(), RequestBody.fromBytes(payload));
        coordinator.recordUploadSuccess(request.requestId(), false);
        UUID otherNote = UUID.randomUUID();
        coordinator.createNote(otherNote, ownerId, 0);
        CountDownLatch ready = new CountDownLatch(2);
        CountDownLatch start = new CountDownLatch(1);
        try (var executor = Executors.newFixedThreadPool(2)) {
            var first = executor.submit(() -> claimAfterBarrier(request.requestId(), noteId, ready, start));
            var second = executor.submit(() -> claimAfterBarrier(request.requestId(), otherNote, ready, start));
            assertTrue(ready.await(5, TimeUnit.SECONDS));
            start.countDown();
            boolean firstWon = first.get(10, TimeUnit.SECONDS);
            boolean secondWon = second.get(10, TimeUnit.SECONDS);
            assertNotEquals(firstWon, secondWon);
        }
        assertEquals(1, coordinator.claimCount(prepared.fileId()));
        assertEquals(1, coordinator.noteFileCount(prepared.fileId()));
        assertTrue(coordinator.noteFileIsBoundToOneOf(prepared.fileId(), noteId, otherNote));
        ProofEvidence.record(s3.runId(), "B06", "two concurrent transactions contested one File UUID across parent Notes; PostgreSQL uniqueness/row lock accepted one claim and stored exactly one association");
    }

    @Test
    void B07_expiredInFlightAttemptRemainsTrackedAcrossEarlyAbsentCheckAndLateCommit() throws Exception {
        byte[] payload = s3.deterministicBytes("B07-late-write", 2 * 1024 * 1024);
        RecoveryCoordinator.IntentRequest request = request(UUID.randomUUID(), noteId, "attachment", payload);
        RecoveryCoordinator.PreparedIntent prepared = coordinator.prepare(request);
        try (S3FaultGate gate = new S3FaultGate(S3FaultGate.Mode.HOLD_AFTER_BODY);
                var client = s3.clientAt(gate.endpoint());
                var executor = Executors.newSingleThreadExecutor()) {
            var put = executor.submit(() -> client.putObject(
                    PutObjectRequest.builder().bucket(s3.bucket()).key(prepared.objectKey()).build(), RequestBody.fromBytes(payload)));
            gate.awaitBodyBarrier();
            coordinator.expireIntent(request.requestId());
            coordinator.markAttemptUnknown(request.requestId());
            assertEquals(RecoveryCoordinator.ReconcileOutcome.ABSENT_STILL_TRACKED,
                    coordinator.reconcileAttempt(request.requestId(), s3.directClient()));
            assertEquals(1, coordinator.pendingAttemptCount());
            gate.releaseBody();
            put.get(10, TimeUnit.SECONDS);

            RecoveryCoordinator restarted = new RecoveryCoordinator(dataSource, s3.bucket());
            assertEquals(RecoveryCoordinator.ReconcileOutcome.DELETED_STILL_TRACKED,
                    restarted.reconcileAttempt(request.requestId(), s3.directClient()));
            assertAbsent(prepared.objectKey());
            assertEquals("TOMBSTONED", restarted.inspect(request.requestId()).state());
            assertEquals(1, restarted.pendingAttemptCount());
            assertFalse(restarted.isAttached(request.requestId()));
        }
        ProofEvidence.record(s3.runId(), "B07", "expired in-flight PUT stayed keyed by a durable UNKNOWN attempt when early HEAD was absent; after late complete PUT, restarted reconciler found/deleted it and retained the tombstone/attempt record");
    }

    @Test
    void B08_deleteFailureKeepsLogicalRemoveDurableAndRetryableAcrossCoordinatorRestart() throws Exception {
        byte[] payload = bytes("B08-delete-retry");
        RecoveryCoordinator.IntentRequest request = request(UUID.randomUUID(), noteId, "attachment", payload);
        RecoveryCoordinator.PreparedIntent prepared = coordinator.prepare(request);
        s3.directClient().putObject(PutObjectRequest.builder().bucket(s3.bucket()).key(prepared.objectKey()).build(), RequestBody.fromBytes(payload));
        coordinator.recordUploadSuccess(request.requestId(), false);
        coordinator.finalizeUpload(request.requestId(), false);
        coordinator.removeAndTombstone(request.requestId());
        assertFalse(coordinator.isAttached(request.requestId()));
        int unavailablePort;
        try (ServerSocket socket = new ServerSocket(0)) { unavailablePort = socket.getLocalPort(); }
        try (var unavailable = s3.clientAt(URI.create("http://127.0.0.1:" + unavailablePort))) {
            assertFalse(coordinator.cleanupKnownAttempt(request.requestId(), unavailable));
        }
        assertEquals("TOMBSTONED", coordinator.inspect(request.requestId()).state());
        assertEquals("DELETE_PENDING", coordinator.attemptState(request.requestId()));
        assertEquals(1, coordinator.pendingAttemptCount());

        RecoveryCoordinator restarted = new RecoveryCoordinator(dataSource, s3.bucket());
        assertTrue(restarted.cleanupKnownAttempt(request.requestId(), s3.directClient()));
        assertAbsent(prepared.objectKey());
        assertFalse(restarted.isAttached(request.requestId()));
        assertEquals("TOMBSTONED", restarted.inspect(request.requestId()).state());
        ProofEvidence.record(s3.runId(), "B08", "logical remove persisted as inaccessible tombstone after S3 DELETE failed; restarted coordinator retried DELETE, verified absence, and retained terminal state");
    }

    @Test
    void B09_confirmedPhysicalDeletionRetainsTerminalTombstoneAndRejectsRetry() throws Exception {
        byte[] payload = bytes("B09-tombstone");
        UUID requestId = UUID.randomUUID();
        RecoveryCoordinator.IntentRequest request = request(requestId, noteId, "attachment", payload);
        RecoveryCoordinator.PreparedIntent prepared = coordinator.prepare(request);
        s3.directClient().putObject(PutObjectRequest.builder().bucket(s3.bucket()).key(prepared.objectKey()).build(), RequestBody.fromBytes(payload));
        coordinator.recordUploadSuccess(requestId, false);
        coordinator.tombstone(requestId);
        assertTrue(coordinator.cleanupKnownAttempt(requestId, s3.directClient()));
        assertAbsent(prepared.objectKey());
        assertEquals("DELETED", coordinator.attemptState(requestId));
        assertEquals("TOMBSTONED", coordinator.inspect(requestId).state());
        assertThrows(RecoveryCoordinator.ConflictException.class, () -> coordinator.prepare(request));
        assertFalse(coordinator.isAttached(requestId));
        ProofEvidence.record(s3.runId(), "B09", "verified physical deletion left a minimal PostgreSQL tombstone; same idempotency UUID could not resurrect the request");
    }

    @Test
    void B10_lostFinalizeResponseReplayDoesNotClaimTwiceOrIncrementVersionAgain() throws Exception {
        byte[] payload = bytes("B10-finalize-replay");
        RecoveryCoordinator.IntentRequest request = request(UUID.randomUUID(), noteId, "inline-image", payload);
        RecoveryCoordinator.PreparedIntent prepared = coordinator.prepare(request);
        s3.directClient().putObject(PutObjectRequest.builder().bucket(s3.bucket()).key(prepared.objectKey()).build(), RequestBody.fromBytes(payload));
        coordinator.recordUploadSuccess(request.requestId(), false);
        assertThrows(RecoveryCoordinator.ResponseLostException.class,
                () -> coordinator.finalizeUpload(request.requestId(), true));
        RecoveryCoordinator.FinalizationResult first = coordinator.inspectFinalization(request.requestId());
        RecoveryCoordinator.FinalizationResult replay = coordinator.finalizeUpload(request.requestId(), false);
        assertEquals(first, replay);
        assertEquals(1, coordinator.claimCount(prepared.fileId()));
        assertEquals(1, coordinator.noteFileCount(prepared.fileId()));
        assertEquals(1, coordinator.noteVersion(noteId));
        ProofEvidence.record(s3.runId(), "B10", "finalize committed before response-loss injection; replay inspected the existing claim and kept the Note version and association count unchanged");
    }

    @Test
    void B11_ordinaryContentPatchCannotRemoveTheProtectedInlineImageAssociation() throws Exception {
        NoteFileContractModel model = new NoteFileContractModel();
        UUID fileId = UUID.randomUUID();
        model.addFile(fileId, true);
        model.insertInlineReference(fileId);
        long versionBeforePatch = model.version();

        model.ordinaryPatch("replacement body with no inline marker");

        assertEquals("replacement body with no inline marker", model.body());
        assertTrue(model.associated(fileId));
        assertEquals(1, model.associationCount());
        assertEquals(1, model.inlineReferenceCount(fileId));
        assertEquals(versionBeforePatch + 1, model.version());
        ProofEvidence.record(s3.runId(), "B11", "behavioral-model only: ordinary content PATCH changed text/version but preserved the protected image association");
    }

    @Test
    void B12_repeatedInlineReferencesShareOneAssociationUntilExplicitLastRemoval() throws Exception {
        NoteFileContractModel model = new NoteFileContractModel();
        UUID fileId = UUID.randomUUID();
        model.addFile(fileId, true);
        model.insertInlineReference(fileId);
        model.insertInlineReference(fileId);
        assertEquals(1, model.associationCount());
        assertEquals(2, model.inlineReferenceCount(fileId));

        model.removeInlineReference(fileId);
        assertTrue(model.associated(fileId));
        assertEquals(1, model.associationCount());
        assertEquals(1, model.inlineReferenceCount(fileId));
        model.removeInlineReference(fileId);
        assertFalse(model.associated(fileId));
        assertEquals(0, model.associationCount());
        assertTrue(model.physicalBytesPresent(), "relational detachment must not imply physical deletion succeeded");
        ProofEvidence.record(s3.runId(), "B12", "behavioral-model only: repeated refs shared one association; first removal retained it, explicit last removal detached it while bytes remained for asynchronous cleanup");
    }

    @Test
    void B13_archiveTrashAndRestorePreserveBytesAndRestrictTrashReads() throws Exception {
        NoteFileContractModel model = new NoteFileContractModel();
        UUID fileId = UUID.randomUUID();
        model.addFile(fileId, true);
        model.archive();
        assertEquals(NoteFileContractModel.Lifecycle.ARCHIVED, model.lifecycle());
        assertTrue(model.canReadOrdinarily());
        model.trash();
        assertEquals(NoteFileContractModel.Lifecycle.TRASHED, model.lifecycle());
        assertFalse(model.canReadOrdinarily());
        assertTrue(model.associated(fileId));
        assertTrue(model.physicalBytesPresent());
        model.restore();
        assertEquals(NoteFileContractModel.Lifecycle.ACTIVE, model.lifecycle());
        assertTrue(model.canReadOrdinarily());
        assertTrue(model.physicalBytesPresent());
        ProofEvidence.record(s3.runId(), "B13", "behavioral-model only: archive stayed readable; Trash denied ordinary reads while retaining association/bytes; restore restored access");
    }

    private boolean claimAfterBarrier(UUID requestId, UUID parentNote, CountDownLatch ready, CountDownLatch start) throws Exception {
        ready.countDown();
        if (!start.await(5, TimeUnit.SECONDS)) throw new IllegalStateException("claim barrier timeout");
        try { return coordinator.claimUploadedFile(requestId, parentNote); }
        catch (RecoveryCoordinator.ConflictException expectedLoser) { return false; }
    }

    private RecoveryCoordinator.IntentRequest request(UUID requestId, UUID parentNote, String role, byte[] content) throws Exception {
        return new RecoveryCoordinator.IntentRequest(
                requestId,
                UUID.randomUUID(),
                ownerId,
                parentNote,
                coordinator.noteVersion(parentNote),
                role,
                content.length,
                sha256(content),
                Instant.now().plus(Duration.ofHours(24)),
                UUID.randomUUID(),
                s3.newObjectKey("B" + "-" + requestId));
    }

    private static byte[] bytes(String value) {
        return value.getBytes(StandardCharsets.UTF_8);
    }

    private static String sha256(byte[] bytes) throws Exception {
        return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
    }

    private void assertAbsent(String key) {
        S3Exception missing = assertThrows(S3Exception.class,
                () -> s3.directClient().headObject(software.amazon.awssdk.services.s3.model.HeadObjectRequest.builder()
                        .bucket(s3.bucket()).key(key).build()));
        assertEquals(404, missing.statusCode());
    }
}
