package com.krishnamurti.horizon.note.web;

import com.krishnamurti.horizon.note.application.NotePage;
import com.krishnamurti.horizon.note.domain.Note;
import com.krishnamurti.horizon.note.domain.NotePreviewBuilder;
import java.util.List;
import org.springframework.stereotype.Component;

/** Maps Note application results into explicit public response DTOs. */
@Component
public class NoteResponseMapper {

    private final NotePreviewBuilder previewBuilder = new NotePreviewBuilder();

    public NoteDetailResponse toDetail(Note note) {
        return new NoteDetailResponse(
                note.getId(),
                note.getTitle(),
                note.getContent(),
                note.getVersion(),
                note.isInbox(),
                note.getArchivedAt(),
                note.getDeletedAt(),
                note.getCreatedAt(),
                note.getUpdatedAt());
    }

    public NoteListResponse toList(NotePage page) {
        List<NoteSummaryResponse> items = page.items().stream().map(this::toSummary).toList();
        return new NoteListResponse(
                items,
                page.page(),
                page.size(),
                page.hasNext(),
                new NoteCountsResponse(page.counts().active(), page.counts().archived()));
    }

    private NoteSummaryResponse toSummary(Note note) {
        return new NoteSummaryResponse(
                note.getId(),
                note.getTitle(),
                previewBuilder.build(note.getContent()),
                note.getVersion(),
                note.isInbox(),
                note.getArchivedAt(),
                note.getCreatedAt(),
                note.getUpdatedAt());
    }
}
