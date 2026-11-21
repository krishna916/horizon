package com.krishnamurti.horizon.note.web;

/** Confirmed version receipt for a soft-deleted Note. */
public record NoteDeletionReceipt(Long id, long version) {}
