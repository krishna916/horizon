package com.krishnamurti.horizon.task.infrastructure;

/** Stored result associated with one user's idempotent task creation request. */
public record TaskCreationReceipt(String fingerprint, Long taskId) {}
