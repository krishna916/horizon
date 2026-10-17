package com.krishnamurti.horizon.task.web;

import com.krishnamurti.horizon.task.domain.Task;
import org.springframework.stereotype.Component;

/** Explicit mapping from the Task aggregate to its HTTP response shapes. */
@Component
public class TaskResponseMapper {

    public TaskSummaryResponse toSummary(Task task) {
        return new TaskSummaryResponse(
                task.getId(),
                task.getTaskKey(),
                task.getTitle(),
                task.getPriority(),
                task.getDueDate(),
                task.isInbox(),
                task.getCompletedAt(),
                task.getArchivedAt(),
                task.getCreatedAt(),
                task.getUpdatedAt());
    }

    public TaskDetailResponse toDetail(Task task) {
        return new TaskDetailResponse(
                task.getId(),
                task.getTaskKey(),
                task.getTitle(),
                task.getPriority(),
                task.getDueDate(),
                task.isInbox(),
                task.getCompletedAt(),
                task.getArchivedAt(),
                task.getCreatedAt(),
                task.getUpdatedAt(),
                task.getDescription(),
                task.getDeletedAt());
    }
}
