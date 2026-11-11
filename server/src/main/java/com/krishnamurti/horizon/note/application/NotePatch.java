package com.krishnamurti.horizon.note.application;

import java.util.List;
import java.util.Map;

/** Presence-aware Note update fields and the version read by the editor. */
public record NotePatch(
        long expectedVersion,
        FieldUpdate<String> title,
        FieldUpdate<Map<String, Object>> content,
        FieldUpdate<List<NoteTagSelection>> tags) {

    public NotePatch(
            long expectedVersion,
            FieldUpdate<String> title,
            FieldUpdate<Map<String, Object>> content) {
        this(expectedVersion, title, content, FieldUpdate.absent());
    }

    public NotePatch {
        if (expectedVersion < 0) {
            throw new IllegalArgumentException("expectedVersion must be nonnegative");
        }
        if (tags == null) {
            throw new IllegalArgumentException("tags update must not be null");
        }
        if (tags.present() && tags.value() == null) {
            throw new IllegalArgumentException("present tags must not be null");
        }
        if (tags.present()) {
            tags = FieldUpdate.of(List.copyOf(tags.value()));
        }
    }
}
