package com.krishnamurti.horizon.task.web;

import jakarta.validation.constraints.NotBlank;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import tools.jackson.databind.JsonNode;

/** HTTP request for creating a workspace task. */
public record CreateTaskRequest(
        @NotBlank String title,
        Map<String, Object> description,
        JsonNode priority,
        JsonNode dueDate,
        List<InitialChecklistItemRequest> checklist) {
    public CreateTaskRequest {
        if (description != null) {
            description = Collections.unmodifiableMap(new LinkedHashMap<>(description));
        }
        checklist = checklist == null ? List.of() : List.copyOf(checklist);
    }

    @Override
    public Map<String, Object> description() {
        return description == null ? null : new LinkedHashMap<>(description);
    }
}
