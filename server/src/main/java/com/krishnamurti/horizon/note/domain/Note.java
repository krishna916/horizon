package com.krishnamurti.horizon.note.domain;

import com.krishnamurti.horizon.shared.domain.BaseEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import org.hibernate.annotations.DynamicUpdate;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/** Aggregate root for an individually owned Note. */
@Entity
@Table(name = "note")
@DynamicUpdate
public class Note extends BaseEntity {

    @Column(name = "user_id", nullable = false, updatable = false)
    private Long userId;

    @Column(name = "title", length = 255)
    private String title;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "content", columnDefinition = "jsonb")
    private Map<String, Object> content;

    @Version
    @Column(name = "version", nullable = false)
    private long version;

    @Column(name = "inbox", nullable = false)
    private boolean inbox;

    @Column(name = "archived_at")
    private java.time.OffsetDateTime archivedAt;

    @Column(name = "deleted_at")
    private java.time.OffsetDateTime deletedAt;

    protected Note() {}

    public static Note create(Long userId, String title, Map<String, Object> content) {
        Note note = new Note();
        note.userId = Objects.requireNonNull(userId, "userId must not be null");
        note.title = normalizeTitle(title);
        note.content = copyJsonMap(content);
        if (note.title == null && note.content == null) {
            throw new InvalidNoteException("content", "a Note requires a title or content");
        }
        note.inbox = false;
        return note;
    }

    public void updateTitle(String title) {
        this.title = normalizeTitle(title);
    }

    public Long getUserId() {
        return userId;
    }

    public String getTitle() {
        return title;
    }

    public Map<String, Object> getContent() {
        return copyJsonMap(content);
    }

    public long getVersion() {
        return version;
    }

    public boolean isInbox() {
        return inbox;
    }

    public java.time.OffsetDateTime getArchivedAt() {
        return archivedAt;
    }

    public java.time.OffsetDateTime getDeletedAt() {
        return deletedAt;
    }

    private static String normalizeTitle(String title) {
        if (title == null) {
            return null;
        }
        String normalized = title.strip();
        if (normalized.isEmpty()) {
            return null;
        }
        if (normalized.length() > 255) {
            throw new InvalidNoteException("title", "title must be at most 255 characters");
        }
        return normalized;
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> copyJsonMap(Map<String, Object> source) {
        if (source == null) {
            return null;
        }
        return (Map<String, Object>) copyJsonValue(source);
    }

    private static Object copyJsonValue(Object value) {
        if (value instanceof Map<?, ?> map) {
            Map<String, Object> copy = new LinkedHashMap<>();
            map.forEach((key, nested) -> copy.put((String) key, copyJsonValue(nested)));
            return copy;
        }
        if (value instanceof List<?> list) {
            List<Object> copy = new ArrayList<>(list.size());
            list.forEach(nested -> copy.add(copyJsonValue(nested)));
            return copy;
        }
        return value;
    }
}
