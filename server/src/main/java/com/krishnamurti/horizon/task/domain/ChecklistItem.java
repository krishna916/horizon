package com.krishnamurti.horizon.task.domain;

import com.krishnamurti.horizon.shared.domain.BaseEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.Objects;
import lombok.Getter;
import org.hibernate.annotations.DynamicUpdate;

/** A lightweight, ordered action owned by a task. */
@Entity
@Table(name = "checklist_item")
@DynamicUpdate
@Getter
public class ChecklistItem extends BaseEntity {

    @Column(name = "task_id", nullable = false, updatable = false)
    private Long taskId;

    @Column(name = "title", nullable = false, length = 255)
    private String title;

    @Column(name = "due_date")
    private LocalDate dueDate;

    @Column(name = "completed_at")
    private OffsetDateTime completedAt;

    @Column(name = "position", nullable = false)
    private int position;

    @Column(name = "deleted_at")
    private OffsetDateTime deletedAt;

    protected ChecklistItem() {}

    public static ChecklistItem create(Long taskId, String title, LocalDate dueDate, int position) {
        ChecklistItem item = new ChecklistItem();
        item.taskId = Objects.requireNonNull(taskId, "taskId must not be null");
        item.title = normalizeTitle(title);
        item.dueDate = dueDate;
        item.moveTo(position);
        return item;
    }

    public void updateTitle(String title) {
        this.title = normalizeTitle(title);
    }

    public void updateDueDate(LocalDate dueDate) {
        this.dueDate = dueDate;
    }

    public void complete(OffsetDateTime when) {
        if (completedAt == null) {
            completedAt = Objects.requireNonNull(when, "when must not be null");
        }
    }

    public void reopen() {
        completedAt = null;
    }

    public void softDelete(OffsetDateTime when) {
        if (deletedAt == null) {
            deletedAt = Objects.requireNonNull(when, "when must not be null");
        }
    }

    public void restore() {
        deletedAt = null;
    }

    public void moveTo(int position) {
        if (position < 0) {
            throw new InvalidTaskException("position", "position must not be negative");
        }
        this.position = position;
    }

    private static String normalizeTitle(String title) {
        if (title == null) {
            throw new InvalidTaskException("title", "title is required");
        }
        String normalized = title.strip();
        if (normalized.isEmpty()) {
            throw new InvalidTaskException("title", "title must not be blank");
        }
        if (normalized.length() > 255) {
            throw new InvalidTaskException("title", "title must be at most 255 characters");
        }
        return normalized;
    }
}
