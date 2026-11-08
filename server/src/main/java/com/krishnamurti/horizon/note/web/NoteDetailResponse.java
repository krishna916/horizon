package com.krishnamurti.horizon.note.web;

import edu.umd.cs.findbugs.annotations.SuppressFBWarnings;
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
        OffsetDateTime createdAt,
        OffsetDateTime updatedAt) {

    public NoteDetailResponse {
        content = NoteJsonCopy.immutableMap(content);
    }

    @Override
    @SuppressFBWarnings(
            value = "EI_EXPOSE_REP",
            justification = "The returned content graph was copied deeply and wrapped immutable.")
    public Map<String, Object> content() {
        return content;
    }
}
