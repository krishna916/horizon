package com.krishnamurti.horizon.task.application;

import java.time.LocalDate;
import java.util.Objects;

/** Presence-aware editable checklist item fields. */
public record ChecklistItemPatch(FieldUpdate<String> title, FieldUpdate<LocalDate> dueDate) {

    public ChecklistItemPatch {
        Objects.requireNonNull(title, "title update must not be null");
        Objects.requireNonNull(dueDate, "dueDate update must not be null");
    }
}
