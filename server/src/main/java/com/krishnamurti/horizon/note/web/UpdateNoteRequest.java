package com.krishnamurti.horizon.note.web;

import com.fasterxml.jackson.annotation.JsonCreator;
import java.util.Map;
import tools.jackson.databind.JsonNode;

/** Raw patch body preserving missing fields separately from JSON null. */
public final class UpdateNoteRequest {

    private final Map<String, JsonNode> fields;

    @JsonCreator(mode = JsonCreator.Mode.DELEGATING)
    public UpdateNoteRequest(Map<String, JsonNode> fields) {
        this.fields = Map.copyOf(fields);
    }

    public Map<String, JsonNode> fields() {
        return fields;
    }
}
