package com.krishnamurti.horizon.note.application;

/** Owner-wide active and archived Note counts, excluding deleted Notes. */
public record NoteCounts(long active, long archived) {}
