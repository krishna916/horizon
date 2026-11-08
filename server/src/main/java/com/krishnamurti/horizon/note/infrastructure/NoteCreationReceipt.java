package com.krishnamurti.horizon.note.infrastructure;

/** Stored owner-scoped request fingerprint and its resulting Note identifier. */
public record NoteCreationReceipt(String fingerprint, Long noteId) {}
