package com.krishnamurti.horizon.task.application;

import com.krishnamurti.horizon.task.domain.TaskPriority;
import java.time.LocalDate;
import java.util.Map;
import java.util.Objects;

/** Typed, presence-aware updates for the four editable Task fields. */
public record TaskPatch(
        FieldUpdate<String> title,
        FieldUpdate<Map<String, Object>> description,
        FieldUpdate<TaskPriority> priority,
        FieldUpdate<LocalDate> dueDate) {

    public TaskPatch {
        Objects.requireNonNull(title, "title update must not be null");
        Objects.requireNonNull(description, "description update must not be null");
        Objects.requireNonNull(priority, "priority update must not be null");
        Objects.requireNonNull(dueDate, "dueDate update must not be null");
    }
}
