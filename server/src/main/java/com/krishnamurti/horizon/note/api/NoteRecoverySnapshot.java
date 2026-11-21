package com.krishnamurti.horizon.note.api;

/** Minimal Note recovery result exposed to other modules. */
public record NoteRecoverySnapshot(Long id, long version, boolean archived) {}
