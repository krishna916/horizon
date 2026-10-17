package com.krishnamurti.horizon.task.web;

import java.util.List;

/** Task-specific collection envelope. */
public record TaskListResponse(List<TaskSummaryResponse> items) {

    public TaskListResponse {
        items = List.copyOf(items);
    }
}
