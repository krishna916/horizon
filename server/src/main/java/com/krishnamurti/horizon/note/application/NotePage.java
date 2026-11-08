package com.krishnamurti.horizon.note.application;

import com.krishnamurti.horizon.note.domain.Note;
import java.util.List;

/** A single bounded slice of a Note collection and its owner-wide counts. */
public record NotePage(List<Note> items, int page, int size, boolean hasNext, NoteCounts counts) {
    public NotePage {
        items = List.copyOf(items);
    }
}
