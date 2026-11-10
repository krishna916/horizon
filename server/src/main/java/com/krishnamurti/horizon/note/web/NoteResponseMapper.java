package com.krishnamurti.horizon.note.web;

import com.krishnamurti.horizon.note.application.NotePage;
import com.krishnamurti.horizon.note.domain.Note;
import com.krishnamurti.horizon.note.domain.NotePreviewBuilder;
import com.krishnamurti.horizon.tag.api.TagReference;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Component;

/** Maps Note application results into explicit public response DTOs. */
@Component
public class NoteResponseMapper {

    private final NotePreviewBuilder previewBuilder = new NotePreviewBuilder();

    public NoteDetailResponse toDetail(Note note) {
        return toDetail(note, List.of());
    }

    public NoteDetailResponse toDetail(Note note, List<TagReference> tags) {
        return new NoteDetailResponse(
                note.getId(),
                note.getTitle(),
                note.getContent(),
                note.getVersion(),
                note.isInbox(),
                note.getArchivedAt(),
                note.getCreatedAt(),
                note.getUpdatedAt(),
                tags.stream().map(NoteTagResponse::from).toList());
    }

    public NoteListResponse toList(NotePage page) {
        return toList(page, Map.of());
    }

    public NoteListResponse toList(NotePage page, Map<Long, List<TagReference>> tagsByNoteId) {
        List<NoteSummaryResponse> items =
                page.items().stream()
                        .map(
                                note ->
                                        toSummary(
                                                note,
                                                tagsByNoteId.getOrDefault(note.getId(), List.of())))
                        .toList();
        return new NoteListResponse(
                items,
                page.page(),
                page.size(),
                page.hasNext(),
                new NoteCountsResponse(page.counts().active(), page.counts().archived()));
    }

    private NoteSummaryResponse toSummary(Note note, List<TagReference> tags) {
        return new NoteSummaryResponse(
                note.getId(),
                note.getTitle(),
                previewBuilder.build(note.getContent()),
                note.getVersion(),
                note.isInbox(),
                note.getArchivedAt(),
                note.getCreatedAt(),
                note.getUpdatedAt(),
                tags.stream().map(NoteTagResponse::from).toList());
    }
}
