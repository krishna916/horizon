package com.krishnamurti.horizon.task.web;

import com.krishnamurti.horizon.task.application.ChecklistItemPatch;
import com.krishnamurti.horizon.task.application.FieldUpdate;
import java.time.LocalDate;
import java.time.format.DateTimeParseException;
import java.util.Map;
import java.util.Set;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;

/** Validates add and patch requests for task checklist items. */
@Component
public class TaskChecklistRequestMapper {

    private static final Set<String> PATCH_FIELDS = Set.of("title", "dueDate");

    public String toAddTitle(AddChecklistItemRequest request) {
        Map<String, JsonNode> fields = request.fields();
        fields.keySet().stream()
                .filter(field -> !Set.of("title").contains(field))
                .findFirst()
                .ifPresent(field -> fail(field, "Field is not editable."));
        return title(fields.get("title"));
    }

    public ChecklistItemPatch toPatch(UpdateChecklistItemRequest request) {
        Map<String, JsonNode> fields = request.fields();
        fields.keySet().stream()
                .filter(field -> !PATCH_FIELDS.contains(field))
                .findFirst()
                .ifPresent(field -> fail(field, "Field is not editable."));
        if (fields.size() != 1) {
            fail("request", "Exactly one editable field must be supplied.");
        }

        FieldUpdate<String> title =
                fields.containsKey("title")
                        ? FieldUpdate.of(title(fields.get("title")))
                        : FieldUpdate.absent();
        FieldUpdate<LocalDate> dueDate =
                fields.containsKey("dueDate")
                        ? FieldUpdate.of(dueDate(fields.get("dueDate")))
                        : FieldUpdate.absent();
        return new ChecklistItemPatch(title, dueDate);
    }

    private String title(JsonNode value) {
        if (value == null || !value.isString()) {
            fail("title", "Must be a non-empty string.");
        }
        String title = value.stringValue().strip();
        if (title.isEmpty()) {
            fail("title", "Must not be blank.");
        }
        if (title.length() > 255) {
            fail("title", "Must be at most 255 characters.");
        }
        return title;
    }

    private LocalDate dueDate(JsonNode value) {
        if (value == null || value.isNull()) {
            return null;
        }
        if (!value.isString()) {
            fail("dueDate", "Must be an ISO date string or null.");
        }
        try {
            return LocalDate.parse(value.stringValue());
        } catch (DateTimeParseException exception) {
            throw new TaskRequestValidationException("dueDate", "Must be a valid ISO date.");
        }
    }

    private void fail(String field, String message) {
        throw new TaskRequestValidationException(field, message);
    }
}
