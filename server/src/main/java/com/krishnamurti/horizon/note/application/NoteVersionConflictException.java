package com.krishnamurti.horizon.note.application;

/** Indicates that a Note changed after the supplied expected version was read. */
public class NoteVersionConflictException extends RuntimeException {

    public NoteVersionConflictException() {
        super("Note version is stale");
    }
}
