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

    @Column(name = "user_id", nullable = false, updatable = false)
    private Long userId;

    @Column(
            name = "name",
            nullable = false,
            length = TagNamePolicy.MAX_NAME_CODE_POINTS,
            updatable = false)
    private String name;

    protected Tag() {}

    public static Tag create(Long userId, String name) {
        Tag tag = new Tag();
        tag.userId = Objects.requireNonNull(userId, "userId must not be null");
        tag.name = TagNamePolicy.normalizeRequiredName(name);
        return tag;
    }
}
