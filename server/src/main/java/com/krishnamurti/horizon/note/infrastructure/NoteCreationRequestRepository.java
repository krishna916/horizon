package com.krishnamurti.horizon.note.infrastructure;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcOperations;
import org.springframework.stereotype.Repository;

/** Persists per-owner idempotency claims in the caller's transaction. */
@Repository
public class NoteCreationRequestRepository {

    private final JdbcOperations jdbcOperations;

    public NoteCreationRequestRepository(JdbcOperations jdbcOperations) {
        this.jdbcOperations = jdbcOperations;
    }

    public boolean claim(Long userId, UUID requestKey, String fingerprint) {
        return jdbcOperations.update(
                        "INSERT INTO note_creation_request (user_id, request_key, fingerprint,"
                                + " created_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP) ON CONFLICT"
                                + " (user_id, request_key) DO NOTHING",
                        userId,
                        requestKey,
                        fingerprint)
                == 1;
    }

    public Optional<NoteCreationReceipt> find(Long userId, UUID requestKey) {
        return jdbcOperations.query(
                "SELECT fingerprint, note_id FROM note_creation_request WHERE user_id = ? AND"
                        + " request_key = ?",
                resultSet ->
                        resultSet.next() ? Optional.of(mapReceipt(resultSet)) : Optional.empty(),
                userId,
                requestKey);
    }

    public void complete(Long userId, UUID requestKey, Long noteId) {
        int updated =
                jdbcOperations.update(
                        "UPDATE note_creation_request SET note_id = ? WHERE user_id = ? AND"
                                + " request_key = ?",
                        noteId,
                        userId,
                        requestKey);
        if (updated != 1) {
            throw new IllegalStateException("Note creation request claim was not found");
        }
    }

    private static NoteCreationReceipt mapReceipt(ResultSet resultSet) throws SQLException {
        return new NoteCreationReceipt(
                resultSet.getString("fingerprint"), resultSet.getObject("note_id", Long.class));
    }
}
