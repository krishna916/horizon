package com.krishnamurti.horizon.note.web;

import edu.umd.cs.findbugs.annotations.SuppressFBWarnings;
import java.time.OffsetDateTime;
import java.util.List;
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
        OffsetDateTime updatedAt,
        List<NoteTagResponse> tags) {

    public NoteSummaryResponse {
        preview = NoteJsonCopy.immutableMap(preview);
        tags = List.copyOf(tags);
    }

    @Override
    @SuppressFBWarnings(
            value = "EI_EXPOSE_REP",
            justification = "The returned preview graph was copied deeply and wrapped immutable.")
    public Map<String, Object> preview() {
        return preview;
    }
}
