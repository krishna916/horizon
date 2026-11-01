package com.krishnamurti.horizon.tag.web;

/** Invalid client-supplied Tag query parameters. */
public class TagRequestValidationException extends RuntimeException {

    private final String field;

    public TagRequestValidationException(String field, String message) {
        super(message);
        this.field = field;
    }

    public String getField() {
        return field;
    }
}
