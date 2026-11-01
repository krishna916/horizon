package com.krishnamurti.horizon.tag.api;

/** Public validation failure for an invalid Tag name or suggestion prefix. */
public class InvalidTagNameException extends RuntimeException {

    private final String field;

    public InvalidTagNameException(String field, String message) {
        super(message);
        this.field = field;
    }

    public String getField() {
        return field;
    }
}
