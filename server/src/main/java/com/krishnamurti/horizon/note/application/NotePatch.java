package com.krishnamurti.horizon.note.application;

import java.util.Map;

/** Presence-aware Note update fields and the version read by the editor. */
public record NotePatch(
        long expectedVersion, FieldUpdate<String> title, FieldUpdate<Map<String, Object>> content) {

    public NotePatch {
        if (expectedVersion < 0) {
            throw new IllegalArgumentException("expectedVersion must be nonnegative");
        }
    }
}
