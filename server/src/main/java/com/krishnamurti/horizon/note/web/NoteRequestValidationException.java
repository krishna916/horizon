package com.krishnamurti.horizon.note.web;

/** Invalid Note HTTP field or query parameter. */
public class NoteRequestValidationException extends RuntimeException {

    private final String field;

    public NoteRequestValidationException(String field, String message) {
        super(message);
        this.field = field;
    }

    public String getField() {
        return field;
    }
}
