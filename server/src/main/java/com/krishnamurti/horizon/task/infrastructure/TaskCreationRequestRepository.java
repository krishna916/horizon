package com.krishnamurti.horizon.task.infrastructure;

import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcOperations;
import org.springframework.stereotype.Repository;

/** Persists per-user idempotency claims in the caller's transaction. */
@Repository
public class TaskCreationRequestRepository {

    private static final String CLAIM_SQL =
            "INSERT INTO task_creation_request (user_id, request_key, request_fingerprint) "
                    + "VALUES (?, ?, ?) ON CONFLICT (user_id, request_key) DO NOTHING";

    private static final String FIND_SQL =
            "SELECT request_fingerprint, task_id FROM task_creation_request "
                    + "WHERE user_id = ? AND request_key = ?";

    private static final String COMPLETE_SQL =
            "UPDATE task_creation_request SET task_id = ? "
                    + "WHERE user_id = ? AND request_key = ? AND task_id IS NULL";

    private final JdbcOperations jdbcOperations;

    public TaskCreationRequestRepository(JdbcOperations jdbcOperations) {
        this.jdbcOperations = jdbcOperations;
    }

    /** Returns true only for the transaction that inserted the owner-scoped request key. */
    public boolean claim(Long userId, UUID requestKey, String fingerprint) {
        return jdbcOperations.update(CLAIM_SQL, userId, requestKey, fingerprint) == 1;
    }

    public Optional<TaskCreationReceipt> find(Long userId, UUID requestKey) {
        List<TaskCreationReceipt> receipts =
                jdbcOperations.query(
                        FIND_SQL,
                        (resultSet, rowNumber) ->
                                new TaskCreationReceipt(
                                        resultSet.getString("request_fingerprint"),
                                        resultSet.getObject("task_id", Long.class)),
                        userId,
                        requestKey);
        return receipts.stream().findFirst();
    }

    /** Associates a successfully created task with its request claim exactly once. */
    public void complete(Long userId, UUID requestKey, Long taskId) {
        int updatedRows = jdbcOperations.update(COMPLETE_SQL, taskId, userId, requestKey);
        if (updatedRows != 1) {
            throw new IllegalStateException("Task creation request claim could not be completed.");
        }
    }
}
