package com.krishnamurti.horizon.note.application;

import com.krishnamurti.horizon.note.domain.Note;
import com.krishnamurti.horizon.tag.api.TagReference;
import java.util.List;

/** Created or replayed Note with its canonical Tag associations. */
public record NoteCreationResult(Note note, List<TagReference> tags) {

    public NoteCreationResult {
        tags = List.copyOf(tags);
    }
}
