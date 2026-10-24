package com.krishnamurti.horizon.task.api;

/** Minimal immutable task facts needed by callers after deleted-task recovery. */
public record TaskRecoverySnapshot(Long id, String key, boolean completed, boolean archived) {}
