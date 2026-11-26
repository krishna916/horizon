package com.krishnamurti.horizon.file.api;

import java.util.Objects;

/** Provider-neutral semantic failure for File module consumers. */
public final class FileOperationException extends RuntimeException {
    public enum Reason {
        NOT_FOUND_OR_FORBIDDEN,
        CONFLICT,
        INVALID_METADATA,
        INVALID_CONTENT,
        SIZE_LIMIT_EXCEEDED,
        UNSUPPORTED_FORMAT,
        CONTENT_UNAVAILABLE,
        STORAGE_UNAVAILABLE
    }

    private final Reason reason;

    public FileOperationException(Reason reason, String message) {
        super(message);
        this.reason = Objects.requireNonNull(reason);
    }

    public FileOperationException(Reason reason, String message, Throwable cause) {
        super(message, cause);
        this.reason = Objects.requireNonNull(reason);
    }

    public Reason reason() {
        return reason;
    }
}
