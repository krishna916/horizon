package com.krishnamurti.horizon.task.web;

import com.fasterxml.jackson.annotation.JsonCreator;
import java.util.Map;
import tools.jackson.databind.JsonNode;

/** Raw checklist item creation fields before validation. */
public final class AddChecklistItemRequest {

    private final Map<String, JsonNode> fields;

    @JsonCreator(mode = JsonCreator.Mode.DELEGATING)
    public AddChecklistItemRequest(Map<String, JsonNode> fields) {
        this.fields = Map.copyOf(fields);
    }

    public Map<String, JsonNode> fields() {
        return fields;
    }
}
