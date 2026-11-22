package com.krishnamurti.horizon.poc.s3;

import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.HexFormat;
import java.util.UUID;
import javax.sql.DataSource;
import software.amazon.awssdk.core.exception.SdkException;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.DeleteObjectRequest;
import software.amazon.awssdk.services.s3.model.GetObjectRequest;
import software.amazon.awssdk.services.s3.model.HeadObjectRequest;
import software.amazon.awssdk.services.s3.model.S3Exception;

/** Test-only PostgreSQL-backed state machine; it is not a production File implementation. */
final class RecoveryCoordinator {

    private final DataSource dataSource;
    private final String bucket;

    RecoveryCoordinator(DataSource dataSource, String bucket) {
        this.dataSource = dataSource;
        this.bucket = bucket;
    }

    void initialize() throws SQLException {
        try (Connection connection = dataSource.getConnection(); Statement sql = connection.createStatement()) {
            sql.execute("CREATE TABLE IF NOT EXISTS poc_note (note_id UUID PRIMARY KEY, owner_id UUID NOT NULL, version BIGINT NOT NULL)");
            sql.execute("CREATE TABLE IF NOT EXISTS poc_upload_intent ("
                    + "request_id UUID PRIMARY KEY, file_id UUID NOT NULL UNIQUE, owner_id UUID NOT NULL, note_id UUID NOT NULL REFERENCES poc_note(note_id), "
                    + "expected_version BIGINT NOT NULL, role VARCHAR(32) NOT NULL, expected_size BIGINT NOT NULL, expected_sha256 CHAR(64) NOT NULL, "
                    + "expires_at TIMESTAMPTZ NOT NULL, state VARCHAR(24) NOT NULL)");
            sql.execute("CREATE TABLE IF NOT EXISTS poc_transfer_attempt ("
                    + "attempt_id UUID PRIMARY KEY, request_id UUID NOT NULL REFERENCES poc_upload_intent(request_id), object_key TEXT NOT NULL UNIQUE, "
                    + "state VARCHAR(24) NOT NULL, expected_size BIGINT NOT NULL, expected_sha256 CHAR(64) NOT NULL, last_reconciled_at TIMESTAMPTZ)");
            sql.execute("CREATE TABLE IF NOT EXISTS poc_note_file ("
                    + "file_id UUID PRIMARY KEY, request_id UUID NOT NULL UNIQUE REFERENCES poc_upload_intent(request_id), "
                    + "owner_id UUID NOT NULL, note_id UUID NOT NULL REFERENCES poc_note(note_id), role VARCHAR(32) NOT NULL, claimed_version BIGINT NOT NULL)");
        }
    }

    void reset() throws SQLException {
        try (Connection connection = dataSource.getConnection(); Statement sql = connection.createStatement()) {
            sql.execute("TRUNCATE poc_note_file, poc_transfer_attempt, poc_upload_intent, poc_note CASCADE");
        }
    }

    void createNote(UUID noteId, UUID ownerId, long version) throws SQLException {
        try (Connection connection = dataSource.getConnection();
                PreparedStatement sql = connection.prepareStatement(
                        "INSERT INTO poc_note(note_id, owner_id, version) VALUES (?, ?, ?)")) {
            sql.setObject(1, noteId);
            sql.setObject(2, ownerId);
            sql.setLong(3, version);
            sql.executeUpdate();
        }
    }

    PreparedIntent prepare(IntentRequest request) throws SQLException {
        try (Connection connection = dataSource.getConnection()) {
            connection.setAutoCommit(false);
            try {
                IntentSnapshot existing = selectIntent(connection, request.requestId(), true);
                if (existing != null) {
                    assertSameFingerprint(existing, request);
                    if (isTerminal(existing.state()) || !existing.expiresAt().isAfter(Instant.now())) {
                        throw new ConflictException("A terminal or expired upload request cannot be recreated");
                    }
                    PreparedIntent original = selectPrepared(connection, request.requestId());
                    connection.commit();
                    return original;
                }
                UUID noteOwner = selectNoteOwner(connection, request.noteId(), true);
                if (!request.ownerId().equals(noteOwner)) throw new ConflictException("Note is not owned by the request owner");
                if (!request.expiresAt().isAfter(Instant.now())) throw new ConflictException("Upload request is already expired");
                try (PreparedStatement sql = connection.prepareStatement(
                        "INSERT INTO poc_upload_intent(request_id,file_id,owner_id,note_id,expected_version,role,expected_size,expected_sha256,expires_at,state) "
                                + "VALUES (?,?,?,?,?,?,?,?,?,'PREPARED')")) {
                    sql.setObject(1, request.requestId());
                    sql.setObject(2, request.fileId());
                    sql.setObject(3, request.ownerId());
                    sql.setObject(4, request.noteId());
                    sql.setLong(5, request.expectedVersion());
                    sql.setString(6, request.role());
                    sql.setLong(7, request.expectedSize());
                    sql.setString(8, request.expectedSha256());
                    sql.setObject(9, OffsetDateTime.ofInstant(request.expiresAt(), ZoneOffset.UTC));
                    sql.executeUpdate();
                }
                try (PreparedStatement sql = connection.prepareStatement(
                        "INSERT INTO poc_transfer_attempt(attempt_id,request_id,object_key,state,expected_size,expected_sha256) "
                                + "VALUES (?,?,?,'UPLOADING',?,?)")) {
                    sql.setObject(1, request.attemptId());
                    sql.setObject(2, request.requestId());
                    sql.setString(3, request.objectKey());
                    sql.setLong(4, request.expectedSize());
                    sql.setString(5, request.expectedSha256());
                    sql.executeUpdate();
                }
                connection.commit();
                return new PreparedIntent(request.fileId(), request.attemptId(), request.objectKey());
            } catch (Exception e) {
                rollback(connection, e);
                if (e instanceof SQLException sqlException) throw sqlException;
                if (e instanceof RuntimeException runtimeException) throw runtimeException;
                throw new IllegalStateException(e);
            }
        }
    }

    IntentSnapshot inspect(UUID requestId) throws SQLException {
        try (Connection connection = dataSource.getConnection()) {
            return selectIntent(connection, requestId, false);
        }
    }

    void recordUploadSuccess(UUID requestId, boolean injectDatabaseFailure) throws SQLException {
        try (Connection connection = dataSource.getConnection()) {
            connection.setAutoCommit(false);
            try {
                IntentSnapshot intent = selectIntent(connection, requestId, true);
                if (intent == null) throw new ConflictException("Upload intent is missing");
                String attempt = selectAttemptState(connection, requestId, true);
                if (!"UPLOADING".equals(attempt) && !"UNKNOWN".equals(attempt)) {
                    throw new ConflictException("Transfer attempt cannot complete from " + attempt);
                }
                if ("TOMBSTONED".equals(intent.state())) {
                    updateAttemptState(connection, requestId, "DELETE_PENDING");
                } else {
                    updateAttemptState(connection, requestId, "COMMITTED");
                    updateIntentState(connection, requestId, "UPLOADED");
                }
                if (injectDatabaseFailure) throw new InjectedDatabaseFailure("simulated database write failure after S3 success");
                connection.commit();
            } catch (Exception e) {
                rollback(connection, e);
                if (e instanceof SQLException sqlException) throw sqlException;
                if (e instanceof RuntimeException runtimeException) throw runtimeException;
                throw new IllegalStateException(e);
            }
        }
    }

    void markAttemptUnknown(UUID requestId) throws SQLException {
        try (Connection connection = dataSource.getConnection()) {
            updateAttemptState(connection, requestId, "UNKNOWN");
        }
    }

    ReconcileOutcome reconcileAttempt(UUID requestId, S3Client verifier) throws SQLException {
        AttemptSnapshot attempt;
        IntentSnapshot intent;
        try (Connection connection = dataSource.getConnection()) {
            intent = selectIntent(connection, requestId, false);
            attempt = selectAttempt(connection, requestId);
        }
        if (intent == null || attempt == null) throw new ConflictException("Durable attempt locator is missing");
        boolean tombstoned = isTerminal(intent.state());
        try {
            byte[] content = readAndVerify(verifier, attempt);
            if (content == null) {
                updateLastReconciled(requestId);
                return ReconcileOutcome.ABSENT_STILL_TRACKED;
            }
            if (tombstoned) {
                verifier.deleteObject(DeleteObjectRequest.builder().bucket(bucket).key(attempt.objectKey()).build());
                if (objectExistsForBucket(verifier, attempt.objectKey())) return ReconcileOutcome.RETRY_REQUIRED;
                updateLastReconciled(requestId);
                return ReconcileOutcome.DELETED_STILL_TRACKED;
            }
            try (Connection connection = dataSource.getConnection()) {
                connection.setAutoCommit(false);
                try {
                    updateAttemptState(connection, requestId, "COMMITTED");
                    updateIntentState(connection, requestId, "UPLOADED");
                    updateLastReconciled(connection, requestId);
                    connection.commit();
                } catch (Exception e) {
                    rollback(connection, e);
                    if (e instanceof SQLException sqlException) throw sqlException;
                    throw e;
                }
            }
            return ReconcileOutcome.UPLOADED;
        } catch (SdkException e) {
            return ReconcileOutcome.RETRY_REQUIRED;
        }
    }

    void expireIntent(UUID requestId) throws SQLException {
        tombstoneInternal(requestId, false);
    }

    void tombstone(UUID requestId) throws SQLException {
        tombstoneInternal(requestId, false);
    }

    void removeAndTombstone(UUID requestId) throws SQLException {
        tombstoneInternal(requestId, true);
    }

    private void tombstoneInternal(UUID requestId, boolean bumpNoteVersion) throws SQLException {
        try (Connection connection = dataSource.getConnection()) {
            connection.setAutoCommit(false);
            try {
                IntentSnapshot intent = selectIntent(connection, requestId, true);
                if (intent == null) throw new ConflictException("Upload intent is missing");
                if (!"TOMBSTONED".equals(intent.state()) && !"DELETED".equals(intent.state())) {
                    updateIntentState(connection, requestId, "TOMBSTONED");
                    try (PreparedStatement sql = connection.prepareStatement("DELETE FROM poc_note_file WHERE request_id=?")) {
                        sql.setObject(1, requestId);
                        int removed = sql.executeUpdate();
                        if (removed > 0 && bumpNoteVersion) {
                            try (PreparedStatement bump = connection.prepareStatement("UPDATE poc_note SET version=version+1 WHERE note_id=?")) {
                                bump.setObject(1, intent.noteId());
                                bump.executeUpdate();
                            }
                        }
                    }
                    String attemptState = selectAttemptState(connection, requestId, true);
                    if ("COMMITTED".equals(attemptState)) updateAttemptState(connection, requestId, "DELETE_PENDING");
                    else if ("UPLOADING".equals(attemptState)) updateAttemptState(connection, requestId, "UNKNOWN");
                }
                connection.commit();
            } catch (Exception e) {
                rollback(connection, e);
                if (e instanceof SQLException sqlException) throw sqlException;
                if (e instanceof RuntimeException runtimeException) throw runtimeException;
                throw new IllegalStateException(e);
            }
        }
    }

    boolean cleanupKnownAttempt(UUID requestId, S3Client client) throws SQLException {
        AttemptSnapshot attempt;
        try (Connection connection = dataSource.getConnection()) {
            attempt = selectAttempt(connection, requestId);
        }
        if (attempt == null) throw new ConflictException("Durable attempt locator is missing");
        if ("UNKNOWN".equals(attempt.state()) || "UPLOADING".equals(attempt.state())) return false;
        updateAttemptState(requestId, "DELETE_PENDING");
        try {
            client.deleteObject(DeleteObjectRequest.builder().bucket(bucket).key(attempt.objectKey()).build());
            if (objectExistsForBucket(client, attempt.objectKey())) return false;
            updateAttemptState(requestId, "DELETED");
            return true;
        } catch (SdkException e) {
            return false;
        }
    }

    boolean claimUploadedFile(UUID requestId, UUID parentNoteId) throws SQLException {
        try (Connection connection = dataSource.getConnection()) {
            connection.setAutoCommit(false);
            try {
                IntentSnapshot intent = selectIntent(connection, requestId, true);
                if (intent == null) throw new ConflictException("Upload intent is missing");
                if (!intent.noteId().equals(parentNoteId)) throw new ConflictException("A File cannot be associated with a different parent Note");
                if ("CLAIMED".equals(intent.state())) {
                    connection.commit();
                    return true;
                }
                if (!"UPLOADED".equals(intent.state())) throw new ConflictException("Only verified uploaded content can be claimed");
                long currentVersion = noteVersion(connection, intent.noteId(), true);
                if (currentVersion != intent.expectedVersion()) throw new StaleNoteVersionException("The Note version changed during transfer");
                try (PreparedStatement sql = connection.prepareStatement(
                        "INSERT INTO poc_note_file(file_id,request_id,owner_id,note_id,role,claimed_version) VALUES (?,?,?,?,?,?)")) {
                    sql.setObject(1, intent.fileId());
                    sql.setObject(2, requestId);
                    sql.setObject(3, intent.ownerId());
                    sql.setObject(4, intent.noteId());
                    sql.setString(5, intent.role());
                    sql.setLong(6, currentVersion + 1);
                    sql.executeUpdate();
                }
                bumpNoteVersion(connection, intent.noteId(), currentVersion);
                updateIntentState(connection, requestId, "CLAIMED");
                connection.commit();
                return true;
            } catch (Exception e) {
                rollback(connection, e);
                if (isUniqueViolation(e)) return false;
                if (e instanceof SQLException sqlException) throw sqlException;
                if (e instanceof RuntimeException runtimeException) throw runtimeException;
                throw new IllegalStateException(e);
            }
        }
    }

    FinalizationResult finalizeUpload(UUID requestId, boolean loseResponseAfterCommit) throws SQLException {
        FinalizationResult result;
        try (Connection connection = dataSource.getConnection()) {
            connection.setAutoCommit(false);
            try {
                IntentSnapshot intent = selectIntent(connection, requestId, true);
                if (intent == null) throw new ConflictException("Upload intent is missing");
                if ("CLAIMED".equals(intent.state())) {
                    result = selectFinalization(connection, requestId);
                    connection.commit();
                } else {
                    if (!"UPLOADED".equals(intent.state())) throw new ConflictException("Only verified uploaded content can be finalized");
                    long currentVersion = noteVersion(connection, intent.noteId(), true);
                    if (currentVersion != intent.expectedVersion()) throw new StaleNoteVersionException("The Note version changed during transfer");
                    try (PreparedStatement sql = connection.prepareStatement(
                            "INSERT INTO poc_note_file(file_id,request_id,owner_id,note_id,role,claimed_version) VALUES (?,?,?,?,?,?)")) {
                        sql.setObject(1, intent.fileId());
                        sql.setObject(2, requestId);
                        sql.setObject(3, intent.ownerId());
                        sql.setObject(4, intent.noteId());
                        sql.setString(5, intent.role());
                        sql.setLong(6, currentVersion + 1);
                        sql.executeUpdate();
                    }
                    bumpNoteVersion(connection, intent.noteId(), currentVersion);
                    updateIntentState(connection, requestId, "CLAIMED");
                    result = new FinalizationResult(intent.fileId(), currentVersion + 1);
                    connection.commit();
                }
            } catch (Exception e) {
                rollback(connection, e);
                if (e instanceof SQLException sqlException) throw sqlException;
                if (e instanceof RuntimeException runtimeException) throw runtimeException;
                throw new IllegalStateException(e);
            }
        }
        if (loseResponseAfterCommit) throw new ResponseLostException("the simulated response was lost after commit");
        return result;
    }

    FinalizationResult inspectFinalization(UUID requestId) throws SQLException {
        try (Connection connection = dataSource.getConnection()) {
            return selectFinalization(connection, requestId);
        }
    }

    void incrementNoteVersion(UUID noteId) throws SQLException {
        try (Connection connection = dataSource.getConnection();
                PreparedStatement sql = connection.prepareStatement("UPDATE poc_note SET version=version+1 WHERE note_id=?")) {
            sql.setObject(1, noteId);
            if (sql.executeUpdate() != 1) throw new ConflictException("Note is missing");
        }
    }

    void refreshExpectedNoteVersion(UUID requestId) throws SQLException {
        try (Connection connection = dataSource.getConnection()) {
            connection.setAutoCommit(false);
            try {
                IntentSnapshot intent = selectIntent(connection, requestId, true);
                if (intent == null || !"UPLOADED".equals(intent.state())) throw new ConflictException("Only a staged upload can refresh its expected Note version");
                long version = noteVersion(connection, intent.noteId(), true);
                try (PreparedStatement sql = connection.prepareStatement("UPDATE poc_upload_intent SET expected_version=? WHERE request_id=?")) {
                    sql.setLong(1, version);
                    sql.setObject(2, requestId);
                    sql.executeUpdate();
                }
                connection.commit();
            } catch (Exception e) {
                rollback(connection, e);
                if (e instanceof SQLException sqlException) throw sqlException;
                if (e instanceof RuntimeException runtimeException) throw runtimeException;
                throw new IllegalStateException(e);
            }
        }
    }

    long noteVersion(UUID noteId) throws SQLException {
        try (Connection connection = dataSource.getConnection()) { return noteVersion(connection, noteId, false); }
    }

    String attemptState(UUID requestId) throws SQLException {
        try (Connection connection = dataSource.getConnection()) { return selectAttemptState(connection, requestId, false); }
    }

    int attemptCount(UUID requestId) throws SQLException {
        return count("SELECT count(*) FROM poc_transfer_attempt WHERE request_id=?", requestId);
    }

    int pendingAttemptCount() throws SQLException {
        try (Connection connection = dataSource.getConnection();
                Statement sql = connection.createStatement();
                ResultSet result = sql.executeQuery("SELECT count(*) FROM poc_transfer_attempt WHERE state <> 'DELETED'")) {
            result.next();
            return result.getInt(1);
        }
    }

    int claimCount(UUID fileId) throws SQLException { return noteFileCount(fileId); }

    int noteFileCount(UUID fileId) throws SQLException {
        try (Connection connection = dataSource.getConnection();
                PreparedStatement sql = connection.prepareStatement("SELECT count(*) FROM poc_note_file WHERE file_id=?")) {
            sql.setObject(1, fileId);
            try (ResultSet result = sql.executeQuery()) { result.next(); return result.getInt(1); }
        }
    }

    boolean noteFileIsBoundToOneOf(UUID fileId, UUID firstNote, UUID secondNote) throws SQLException {
        try (Connection connection = dataSource.getConnection();
                PreparedStatement sql = connection.prepareStatement("SELECT note_id FROM poc_note_file WHERE file_id=?")) {
            sql.setObject(1, fileId);
            try (ResultSet result = sql.executeQuery()) {
                if (!result.next()) return false;
                UUID stored = result.getObject(1, UUID.class);
                return stored.equals(firstNote) || stored.equals(secondNote);
            }
        }
    }

    boolean isAttached(UUID requestId) throws SQLException {
        try (Connection connection = dataSource.getConnection();
                PreparedStatement sql = connection.prepareStatement("SELECT 1 FROM poc_note_file WHERE request_id=?")) {
            sql.setObject(1, requestId);
            try (ResultSet result = sql.executeQuery()) { return result.next(); }
        }
    }

    private int count(String query, UUID requestId) throws SQLException {
        try (Connection connection = dataSource.getConnection(); PreparedStatement sql = connection.prepareStatement(query)) {
            sql.setObject(1, requestId);
            try (ResultSet result = sql.executeQuery()) { result.next(); return result.getInt(1); }
        }
    }

    private boolean objectExistsForBucket(S3Client client, String objectKey) {
        try {
            client.headObject(HeadObjectRequest.builder().bucket(bucket).key(objectKey).build());
            return true;
        } catch (S3Exception e) {
            if (e.statusCode() == 404) return false;
            throw e;
        }
    }

    private byte[] readAndVerify(S3Client client, AttemptSnapshot attempt) {
        if (!objectExistsForBucket(client, attempt.objectKey())) return null;
        byte[] content = client.getObjectAsBytes(GetObjectRequest.builder().bucket(bucket).key(attempt.objectKey()).build()).asByteArray();
        if (content.length != attempt.expectedSize() || !sha256(content).equals(attempt.expectedSha256().trim())) {
            throw new ConflictException("Remote object does not match the durable size and SHA-256");
        }
        return content;
    }

    private void updateLastReconciled(UUID requestId) throws SQLException {
        try (Connection connection = dataSource.getConnection()) { updateLastReconciled(connection, requestId); }
    }

    private void updateLastReconciled(Connection connection, UUID requestId) throws SQLException {
        try (PreparedStatement sql = connection.prepareStatement("UPDATE poc_transfer_attempt SET last_reconciled_at=? WHERE request_id=?")) {
            sql.setObject(1, OffsetDateTime.ofInstant(Instant.now(), ZoneOffset.UTC));
            sql.setObject(2, requestId);
            sql.executeUpdate();
        }
    }

    private static IntentSnapshot selectIntent(Connection connection, UUID requestId, boolean lock) throws SQLException {
        String query = "SELECT i.request_id,i.file_id,i.owner_id,i.note_id,i.expected_version,i.role,i.expected_size,i.expected_sha256,i.expires_at,i.state,a.attempt_id,a.object_key "
                + "FROM poc_upload_intent i LEFT JOIN poc_transfer_attempt a ON a.request_id=i.request_id WHERE i.request_id=?" + (lock ? " FOR UPDATE OF i" : "");
        try (PreparedStatement sql = connection.prepareStatement(query)) {
            sql.setObject(1, requestId);
            try (ResultSet result = sql.executeQuery()) {
                if (!result.next()) return null;
                return new IntentSnapshot(
                        result.getObject("request_id", UUID.class), result.getObject("file_id", UUID.class), result.getObject("owner_id", UUID.class),
                        result.getObject("note_id", UUID.class), result.getLong("expected_version"), result.getString("role"), result.getLong("expected_size"),
                        result.getString("expected_sha256").trim(), result.getObject("expires_at", OffsetDateTime.class).toInstant(), result.getString("state"),
                        result.getObject("attempt_id", UUID.class), result.getString("object_key"));
            }
        }
    }

    private static PreparedIntent selectPrepared(Connection connection, UUID requestId) throws SQLException {
        try (PreparedStatement sql = connection.prepareStatement("SELECT i.file_id,a.attempt_id,a.object_key FROM poc_upload_intent i JOIN poc_transfer_attempt a USING(request_id) WHERE request_id=?")) {
            sql.setObject(1, requestId);
            try (ResultSet result = sql.executeQuery()) {
                result.next();
                return new PreparedIntent(result.getObject(1, UUID.class), result.getObject(2, UUID.class), result.getString(3));
            }
        }
    }

    private static AttemptSnapshot selectAttempt(Connection connection, UUID requestId) throws SQLException {
        try (PreparedStatement sql = connection.prepareStatement(
                "SELECT attempt_id,object_key,state,expected_size,expected_sha256 FROM poc_transfer_attempt WHERE request_id=? ORDER BY attempt_id LIMIT 1")) {
            sql.setObject(1, requestId);
            try (ResultSet result = sql.executeQuery()) {
                if (!result.next()) return null;
                return new AttemptSnapshot(result.getObject(1, UUID.class), result.getString(2), result.getString(3), result.getLong(4), result.getString(5).trim());
            }
        }
    }

    private static String selectAttemptState(Connection connection, UUID requestId, boolean lock) throws SQLException {
        try (PreparedStatement sql = connection.prepareStatement("SELECT state FROM poc_transfer_attempt WHERE request_id=?" + (lock ? " FOR UPDATE" : ""))) {
            sql.setObject(1, requestId);
            try (ResultSet result = sql.executeQuery()) { if (!result.next()) return null; return result.getString(1); }
        }
    }

    private static UUID selectNoteOwner(Connection connection, UUID noteId, boolean lock) throws SQLException {
        try (PreparedStatement sql = connection.prepareStatement("SELECT owner_id FROM poc_note WHERE note_id=?" + (lock ? " FOR UPDATE" : ""))) {
            sql.setObject(1, noteId);
            try (ResultSet result = sql.executeQuery()) { if (!result.next()) throw new ConflictException("Note is missing"); return result.getObject(1, UUID.class); }
        }
    }

    private static long noteVersion(Connection connection, UUID noteId, boolean lock) throws SQLException {
        try (PreparedStatement sql = connection.prepareStatement("SELECT version FROM poc_note WHERE note_id=?" + (lock ? " FOR UPDATE" : ""))) {
            sql.setObject(1, noteId);
            try (ResultSet result = sql.executeQuery()) { if (!result.next()) throw new ConflictException("Note is missing"); return result.getLong(1); }
        }
    }

    private static void bumpNoteVersion(Connection connection, UUID noteId, long expected) throws SQLException {
        try (PreparedStatement sql = connection.prepareStatement("UPDATE poc_note SET version=version+1 WHERE note_id=? AND version=?")) {
            sql.setObject(1, noteId);
            sql.setLong(2, expected);
            if (sql.executeUpdate() != 1) throw new StaleNoteVersionException("Concurrent Note version update");
        }
    }

    private static FinalizationResult selectFinalization(Connection connection, UUID requestId) throws SQLException {
        try (PreparedStatement sql = connection.prepareStatement("SELECT file_id,claimed_version FROM poc_note_file WHERE request_id=?")) {
            sql.setObject(1, requestId);
            try (ResultSet result = sql.executeQuery()) {
                if (!result.next()) throw new ConflictException("No committed finalization is available to replay");
                return new FinalizationResult(result.getObject(1, UUID.class), result.getLong(2));
            }
        }
    }

    private static void updateIntentState(Connection connection, UUID requestId, String state) throws SQLException {
        try (PreparedStatement sql = connection.prepareStatement("UPDATE poc_upload_intent SET state=? WHERE request_id=?")) {
            sql.setString(1, state);
            sql.setObject(2, requestId);
            if (sql.executeUpdate() != 1) throw new ConflictException("Upload intent is missing");
        }
    }

    private void updateAttemptState(UUID requestId, String state) throws SQLException {
        try (Connection connection = dataSource.getConnection()) { updateAttemptState(connection, requestId, state); }
    }

    private static void updateAttemptState(Connection connection, UUID requestId, String state) throws SQLException {
        try (PreparedStatement sql = connection.prepareStatement("UPDATE poc_transfer_attempt SET state=? WHERE request_id=?")) {
            sql.setString(1, state);
            sql.setObject(2, requestId);
            if (sql.executeUpdate() != 1) throw new ConflictException("Transfer attempt is missing");
        }
    }

    private static void assertSameFingerprint(IntentSnapshot existing, IntentRequest request) {
        if (!existing.ownerId().equals(request.ownerId()) || !existing.noteId().equals(request.noteId())
                || !existing.role().equals(request.role()) || existing.expectedSize() != request.expectedSize()
                || !existing.expectedSha256().equalsIgnoreCase(request.expectedSha256())) {
            throw new ConflictException("Idempotency UUID was reused for different Note/content metadata");
        }
    }

    private static boolean isTerminal(String state) { return "TOMBSTONED".equals(state) || "DELETED".equals(state) || "EXPIRED".equals(state); }

    private static boolean isUniqueViolation(Throwable failure) {
        for (Throwable cause = failure; cause != null; cause = cause.getCause()) {
            if (cause instanceof SQLException sql && "23505".equals(sql.getSQLState())) return true;
        }
        return false;
    }

    private static void rollback(Connection connection, Exception original) {
        try { connection.rollback(); } catch (SQLException rollbackFailure) { original.addSuppressed(rollbackFailure); }
    }

    private static String sha256(byte[] content) {
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(content)); }
        catch (NoSuchAlgorithmException e) { throw new IllegalStateException("SHA-256 is required", e); }
    }

    record IntentRequest(UUID requestId, UUID fileId, UUID ownerId, UUID noteId, long expectedVersion, String role,
            long expectedSize, String expectedSha256, Instant expiresAt, UUID attemptId, String objectKey) {}
    record PreparedIntent(UUID fileId, UUID attemptId, String objectKey) {}
    record IntentSnapshot(UUID requestId, UUID fileId, UUID ownerId, UUID noteId, long expectedVersion, String role,
            long expectedSize, String expectedSha256, Instant expiresAt, String state, UUID attemptId, String objectKey) {}
    record FinalizationResult(UUID fileId, long noteVersion) {}
    private record AttemptSnapshot(UUID attemptId, String objectKey, String state, long expectedSize, String expectedSha256) {}
    enum ReconcileOutcome { ABSENT_STILL_TRACKED, UPLOADED, DELETED_STILL_TRACKED, RETRY_REQUIRED }

    static class ConflictException extends RuntimeException { ConflictException(String message) { super(message); } }
    static final class StaleNoteVersionException extends ConflictException { StaleNoteVersionException(String message) { super(message); } }
    static final class InjectedDatabaseFailure extends RuntimeException { InjectedDatabaseFailure(String message) { super(message); } }
    static final class ResponseLostException extends RuntimeException { ResponseLostException(String message) { super(message); } }
}
