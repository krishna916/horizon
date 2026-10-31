package com.krishnamurti.horizon.tag.domain;

/** Raised when a Tag value violates a domain invariant. */
public class InvalidTagException extends RuntimeException {

    private final String field;

    public InvalidTagException(String field, String message) {
        super(message);
        this.field = field;
    }

    public String getField() {
        return field;
    }
}
