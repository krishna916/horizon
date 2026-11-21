package com.krishnamurti.horizon.note.api;

/** Public Note recovery operations for collaborating modules. */
public interface NoteRecoveryApi {

    NoteRecoverySnapshot restoreDeletedNote(Long noteId, long expectedVersion);
}
