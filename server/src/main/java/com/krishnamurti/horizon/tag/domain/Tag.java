package com.krishnamurti.horizon.tag.domain;

import com.krishnamurti.horizon.shared.domain.BaseEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.util.Objects;
import lombok.Getter;

/** Aggregate root for a user-owned, reusable tag. */
@Entity
@Table(name = "tag")
@Getter
public class Tag extends BaseEntity {

    private static final int MAX_NAME_CODE_POINTS = 100;

    @Column(name = "user_id", nullable = false, updatable = false)
    private Long userId;

    @Column(name = "name", nullable = false, length = MAX_NAME_CODE_POINTS, updatable = false)
    private String name;

    protected Tag() {}

    public static Tag create(Long userId, String name) {
        Tag tag = new Tag();
        tag.userId = Objects.requireNonNull(userId, "userId must not be null");
        tag.name = normalizeName(name);
        return tag;
    }

    private static String normalizeName(String name) {
        if (name == null) {
            throw new InvalidTagException("name", "name is required");
        }
        if (name.codePoints().anyMatch(Character::isISOControl)) {
            throw new InvalidTagException("name", "name must not contain control characters");
        }

        String trimmed = trimEdgeSpaces(name);
        if (trimmed.isEmpty()) {
            throw new InvalidTagException("name", "name must not be blank");
        }
        if (trimmed.codePointCount(0, trimmed.length()) > MAX_NAME_CODE_POINTS) {
            throw new InvalidTagException("name", "name must be at most 100 Unicode code points");
        }
        return trimmed;
    }

    private static String trimEdgeSpaces(String value) {
        int start = 0;
        int end = value.length();

        while (start < end) {
            int codePoint = value.codePointAt(start);
            if (!isEdgeSpace(codePoint)) {
                break;
            }
            start += Character.charCount(codePoint);
        }
        while (end > start) {
            int codePoint = value.codePointBefore(end);
            if (!isEdgeSpace(codePoint)) {
                break;
            }
            end -= Character.charCount(codePoint);
        }
        return value.substring(start, end);
    }

    private static boolean isEdgeSpace(int codePoint) {
        return Character.isWhitespace(codePoint) || Character.isSpaceChar(codePoint);
    }
}
