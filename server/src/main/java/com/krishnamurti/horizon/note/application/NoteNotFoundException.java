package com.krishnamurti.horizon.note.application;

/** Indicates that an owned, undeleted Note could not be found. */
public class NoteNotFoundException extends RuntimeException {

    public NoteNotFoundException(Long noteId) {
        super("Note not found: " + noteId);
    }
}
