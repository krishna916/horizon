package com.krishnamurti.horizon.task.domain;

/** Raised when a Task value violates a domain invariant. */
public class InvalidTaskException extends RuntimeException {

    private final String field;

    public InvalidTaskException(String field, String message) {
        super(message);
        this.field = field;
    }

    public String getField() {
        return field;
    }
}
