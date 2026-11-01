package com.krishnamurti.horizon.tag.web;

import com.krishnamurti.horizon.tag.api.TagReference;
import java.util.List;

/** Stable response envelope for Tag autocomplete. */
public record TagSuggestionsResponse(List<TagReference> items) {

    public TagSuggestionsResponse {
        items = List.copyOf(items);
    }
}
