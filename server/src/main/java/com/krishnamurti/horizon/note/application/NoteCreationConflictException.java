package com.krishnamurti.horizon.note.application;

/** Raised when an idempotency key cannot safely replay a Note creation. */
public class NoteCreationConflictException extends RuntimeException {

    public NoteCreationConflictException() {
        super("The idempotency key conflicts with an existing Note creation request");
    }
}
