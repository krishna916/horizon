package com.krishnamurti.horizon.note.web;

import com.krishnamurti.horizon.tag.api.TagReference;

/** Public Tag representation embedded in Note responses. */
public record NoteTagResponse(Long id, String name) {

    public static NoteTagResponse from(TagReference tag) {
        return new NoteTagResponse(tag.id(), tag.name());
    }
}
