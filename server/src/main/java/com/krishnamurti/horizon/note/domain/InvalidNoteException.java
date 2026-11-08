package com.krishnamurti.horizon.note.domain;

/** Raised when a Note violates a domain invariant. */
public class InvalidNoteException extends IllegalArgumentException {

    private final String field;

    public InvalidNoteException(String field, String message) {
        super(message);
        this.field = field;
    }

    public String getField() {
        return field;
    }
}
