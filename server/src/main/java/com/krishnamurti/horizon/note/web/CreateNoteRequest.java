package com.krishnamurti.horizon.note.web;

import com.fasterxml.jackson.annotation.JsonCreator;
import java.util.Map;
import tools.jackson.databind.JsonNode;

/** Raw create body preserving explicit null values for validation. */
public final class CreateNoteRequest {

    private final Map<String, JsonNode> fields;

    @JsonCreator(mode = JsonCreator.Mode.DELEGATING)
    public CreateNoteRequest(Map<String, JsonNode> fields) {
        this.fields = Map.copyOf(fields);
    }

    public Map<String, JsonNode> fields() {
        return fields;
    }
}
