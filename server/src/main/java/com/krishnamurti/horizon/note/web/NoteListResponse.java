package com.krishnamurti.horizon.note.web;

import java.util.List;

/** Paginated Note collection response. */
public record NoteListResponse(
        List<NoteSummaryResponse> items,
        int page,
        int size,
        boolean hasNext,
        NoteCountsResponse counts) {
    public NoteListResponse {
        items = List.copyOf(items);
    }
}
