package com.krishnamurti.horizon.note.web;

import java.time.OffsetDateTime;
import java.util.Map;

/** Compact Note list item; only bounded structured preview content is exposed. */
public record NoteSummaryResponse(
        Long id,
        String title,
        Map<String, Object> preview,
        long version,
        boolean inbox,
        OffsetDateTime archivedAt,
        OffsetDateTime createdAt,
        OffsetDateTime updatedAt) {}
