package com.krishnamurti.horizon.task.web;

import com.krishnamurti.horizon.task.domain.TaskPriority;
import jakarta.validation.constraints.NotBlank;
import java.time.LocalDate;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;

/** HTTP request for creating a workspace task. */
public record CreateTaskRequest(
        @NotBlank String title,
        Map<String, Object> description,
        TaskPriority priority,
        LocalDate dueDate) {
    public CreateTaskRequest {
        if (description != null) {
            description = Collections.unmodifiableMap(new LinkedHashMap<>(description));
        }
    }

    @Override
    public Map<String, Object> description() {
        return description == null ? null : new LinkedHashMap<>(description);
    }
}
