package com.krishnamurti.horizon.task.web;

import com.krishnamurti.horizon.task.domain.TaskPriority;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Complete task representation returned by create, get, and update operations. */
public record TaskDetailResponse(
        Long id,
        String key,
        String title,
        TaskPriority priority,
        LocalDate dueDate,
        boolean inbox,
        OffsetDateTime completedAt,
        OffsetDateTime archivedAt,
        OffsetDateTime createdAt,
        OffsetDateTime updatedAt,
        Map<String, Object> description,
        OffsetDateTime deletedAt,
        List<ChecklistItemResponse> checklist) {
    public TaskDetailResponse {
        if (description != null) {
            description = Collections.unmodifiableMap(new LinkedHashMap<>(description));
        }
        checklist = checklist == null ? List.of() : List.copyOf(checklist);
    }

    @Override
    public Map<String, Object> description() {
        return description == null ? null : new LinkedHashMap<>(description);
    }
}
