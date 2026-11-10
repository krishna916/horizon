package com.krishnamurti.horizon.note.application;

import com.krishnamurti.horizon.note.domain.Note;
import com.krishnamurti.horizon.tag.api.TagReference;
import edu.umd.cs.findbugs.annotations.SuppressFBWarnings;
import java.util.List;

/** Created or replayed Note with its canonical Tag associations. */
public record NoteCreationResult(Note note, List<TagReference> tags) {

    @SuppressFBWarnings(
            value = "EI_EXPOSE_REP2",
            justification =
                    "The managed Note aggregate is intentionally carried to the HTTP adapter for"
                            + " response mapping.")
    public NoteCreationResult {
        tags = List.copyOf(tags);
    }

    @SuppressFBWarnings(
            value = "EI_EXPOSE_REP",
            justification =
                    "The managed Note aggregate is intentionally carried to the HTTP adapter for"
                            + " response mapping.")
    public Note note() {
        return note;
    }
}
