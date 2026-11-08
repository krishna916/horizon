package com.krishnamurti.horizon.note.web;

import java.time.OffsetDateTime;
import java.util.Map;

/** Full Note representation returned by create, detail, and patch operations. */
public record NoteDetailResponse(
        Long id,
        String title,
        Map<String, Object> content,
        long version,
        boolean inbox,
        OffsetDateTime archivedAt,
        OffsetDateTime deletedAt,
        OffsetDateTime createdAt,
        OffsetDateTime updatedAt) {}
