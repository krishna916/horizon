package com.krishnamurti.horizon.task.web;

import com.fasterxml.jackson.annotation.JsonCreator;
import java.util.Map;
import tools.jackson.databind.JsonNode;

/** Raw presence-aware task update fields before request validation. */
public final class UpdateTaskRequest {

    private final Map<String, JsonNode> fields;

    @JsonCreator(mode = JsonCreator.Mode.DELEGATING)
    public UpdateTaskRequest(Map<String, JsonNode> fields) {
        this.fields = Map.copyOf(fields);
    }

    public Map<String, JsonNode> fields() {
        return fields;
    }
}
