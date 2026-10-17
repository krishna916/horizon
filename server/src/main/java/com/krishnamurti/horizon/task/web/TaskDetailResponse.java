package com.krishnamurti.horizon.task.web;

import com.krishnamurti.horizon.task.domain.TaskPriority;
import java.time.LocalDate;
import java.time.OffsetDateTime;
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
        OffsetDateTime deletedAt) {}
