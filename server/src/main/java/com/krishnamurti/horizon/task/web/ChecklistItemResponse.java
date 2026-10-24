package com.krishnamurti.horizon.task.web;

import com.krishnamurti.horizon.task.domain.ChecklistItem;
import java.time.LocalDate;
import java.time.OffsetDateTime;

/** Public checklist representation without persistence or ownership fields. */
public record ChecklistItemResponse(
        Long id, String title, LocalDate dueDate, OffsetDateTime completedAt, int position) {

    public static ChecklistItemResponse from(ChecklistItem item) {
        return new ChecklistItemResponse(
                item.getId(),
                item.getTitle(),
                item.getDueDate(),
                item.getCompletedAt(),
                item.getPosition());
    }
}
