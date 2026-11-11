package com.krishnamurti.horizon.note.application;

/** Invalid or non-owned Tag reference supplied for a Note. */
public class InvalidNoteTagReferenceException extends RuntimeException {

    public InvalidNoteTagReferenceException() {
        super("One or more Tag references are invalid.");
    }
}
