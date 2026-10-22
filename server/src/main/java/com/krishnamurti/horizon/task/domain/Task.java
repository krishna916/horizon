package com.krishnamurti.horizon.task.domain;

import com.krishnamurti.horizon.shared.domain.BaseEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Convert;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import lombok.Getter;
import org.hibernate.annotations.DynamicUpdate;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/** Aggregate root for an individually owned task. */
@Entity
@Table(name = "task")
@DynamicUpdate
@Getter
public class Task extends BaseEntity {

    @Column(name = "user_id", nullable = false, updatable = false)
    private Long userId;

    @Column(name = "task_key", nullable = false, length = 64, updatable = false)
    private String taskKey;

    @Column(name = "title", nullable = false, length = 255)
    private String title;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "description", columnDefinition = "jsonb")
    private Map<String, Object> description;

    @Convert(converter = TaskPriorityConverter.class)
    @Column(name = "priority_id")
    private TaskPriority priority;

    @Column(name = "due_date")
    private LocalDate dueDate;

    @Column(name = "inbox", nullable = false)
    private boolean inbox;

    @Column(name = "completed_at")
    private OffsetDateTime completedAt;

    @Column(name = "archived_at")
    private OffsetDateTime archivedAt;

    @Column(name = "deleted_at")
    private OffsetDateTime deletedAt;

    protected Task() {}

    public static Task create(
            Long ownerId,
            String taskKey,
            String title,
            Map<String, Object> description,
            TaskPriority priority,
            LocalDate dueDate) {
        Task task = new Task();
        task.userId = Objects.requireNonNull(ownerId, "ownerId must not be null");
        task.taskKey = Objects.requireNonNull(taskKey, "taskKey must not be null");
        task.title = normalizeTitle(title);
        task.description = copyAndValidateDescription(description);
        task.priority = priority;
        task.dueDate = dueDate;
        task.inbox = false;
        return task;
    }

    public void updateTitle(String title) {
        this.title = normalizeTitle(title);
    }

    public void updateDescription(Map<String, Object> description) {
        this.description = copyAndValidateDescription(description);
    }

    public void updatePriority(TaskPriority priority) {
        this.priority = priority;
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

    /**
     * Returns a defensive copy so nested document edits are persisted only through
     * updateDescription.
     */
    public Map<String, Object> getDescription() {
        return copyJsonMap(description);
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

    private static Map<String, Object> copyAndValidateDescription(Map<String, Object> description) {
        if (description == null) {
            return null;
        }
        if (!"doc".equals(description.get("type"))
                || !(description.get("content") instanceof List<?>)) {
            throw new InvalidTaskException(
                    "description", "description must be a document with an array content field");
        }
        return copyJsonMap(description);
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> copyJsonMap(Map<String, Object> value) {
        if (value == null) {
            return null;
        }
        return (Map<String, Object>) copyJsonValue(value);
    }

    private static Object copyJsonValue(Object value) {
        if (value instanceof Map<?, ?> map) {
            Map<String, Object> copy = new LinkedHashMap<>();
            map.forEach((key, nestedValue) -> copy.put((String) key, copyJsonValue(nestedValue)));
            return copy;
        }
        if (value instanceof List<?> list) {
            List<Object> copy = new ArrayList<>(list.size());
            list.forEach(item -> copy.add(copyJsonValue(item)));
            return copy;
        }
        return value;
    }
}
