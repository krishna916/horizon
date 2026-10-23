package com.krishnamurti.horizon.task.application;

import com.krishnamurti.horizon.task.domain.InvalidTaskException;
import java.time.LocalDate;

/** Normalized checklist child supplied as part of an atomic task creation request. */
public record InitialChecklistItem(String title, LocalDate dueDate) {

    public InitialChecklistItem {
        if (title == null) {
            throw new InvalidTaskException("checklist.title", "title is required");
        }
        title = title.strip();
        if (title.isEmpty()) {
            throw new InvalidTaskException("checklist.title", "title must not be blank");
        }
        if (title.length() > 255) {
            throw new InvalidTaskException(
                    "checklist.title", "title must be at most 255 characters");
        }
    }
}
