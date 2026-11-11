package com.krishnamurti.horizon.note.application;

/** One Tag reference supplied to a Note create or update request. */
public record NoteTagSelection(Long id, String name) {

    public NoteTagSelection {
        if ((id == null) == (name == null) || (id != null && id <= 0)) {
            throw new InvalidNoteTagReferenceException();
        }
    }
}
