package com.krishnamurti.horizon.task.web;

import com.krishnamurti.horizon.task.domain.TaskPriority;
import java.time.LocalDate;
import java.time.OffsetDateTime;

/** Shallow representation used by the task collection. */
public record TaskSummaryResponse(
        Long id,
        String key,
        String title,
        TaskPriority priority,
        LocalDate dueDate,
        boolean inbox,
        OffsetDateTime completedAt,
        OffsetDateTime archivedAt,
        OffsetDateTime createdAt,
        OffsetDateTime updatedAt) {}
