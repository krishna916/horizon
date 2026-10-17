package com.krishnamurti.horizon.task.web;

import com.krishnamurti.horizon.task.application.FieldUpdate;
import com.krishnamurti.horizon.task.application.TaskPatch;
import com.krishnamurti.horizon.task.domain.TaskPriority;
import java.time.LocalDate;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;

/** Validates PATCH JSON and maps supplied fields to typed application updates. */
@Component
public class TaskRequestMapper {

    private static final Set<String> EDITABLE_FIELDS =
            Set.of("title", "description", "priority", "dueDate");

    public TaskPatch toPatch(UpdateTaskRequest request) {
        Map<String, JsonNode> fields = request.fields();
        fields.keySet().stream()
                .filter(field -> !EDITABLE_FIELDS.contains(field))
                .findFirst()
                .ifPresent(field -> fail(field, "Field is not editable."));
        if (fields.isEmpty()) {
            fail("request", "At least one editable field must be supplied.");
        }

        return new TaskPatch(
                stringUpdate(fields, "title"),
                descriptionUpdate(fields),
                priorityUpdate(fields),
                dateUpdate(fields));
    }

    public TaskPriority parsePriority(JsonNode value) {
        if (value == null || value.isNull()) {
            return null;
        }
        if (!value.isString()) {
            fail("priority", "Must be a valid priority string or null.");
        }
        try {
            return TaskPriority.valueOf(value.stringValue());
        } catch (IllegalArgumentException exception) {
            throw new TaskRequestValidationException("priority", "Must be a valid priority.");
        }
    }

    public LocalDate parseDueDate(JsonNode value) {
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

    private FieldUpdate<String> stringUpdate(Map<String, JsonNode> fields, String field) {
        if (!fields.containsKey(field)) {
            return FieldUpdate.absent();
        }
        JsonNode value = fields.get(field);
        if (value.isNull()) {
            fail(field, "Must be a non-empty string.");
        }
        if (!value.isString()) {
            fail(field, "Must be a string.");
        }
        String normalized = value.stringValue().strip();
        if (normalized.isEmpty()) {
            fail(field, "Must not be blank.");
        }
        return FieldUpdate.of(normalized);
    }

    private FieldUpdate<Map<String, Object>> descriptionUpdate(Map<String, JsonNode> fields) {
        if (!fields.containsKey("description")) {
            return FieldUpdate.absent();
        }
        JsonNode value = fields.get("description");
        if (value.isNull()) {
            return FieldUpdate.of(null);
        }
        if (!value.isObject()) {
            fail("description", "Must be a document object or null.");
        }
        JsonNode type = value.get("type");
        JsonNode content = value.get("content");
        if (type == null || !type.isString() || !"doc".equals(type.stringValue())) {
            fail("description", "Must be a valid document with type 'doc'.");
        }
        if (content == null || !content.isArray()) {
            fail("description", "Must be a valid document with an array content field.");
        }
        @SuppressWarnings("unchecked")
        Map<String, Object> document = (Map<String, Object>) toJavaValue(value);
        return FieldUpdate.of(document);
    }

    private FieldUpdate<TaskPriority> priorityUpdate(Map<String, JsonNode> fields) {
        if (!fields.containsKey("priority")) {
            return FieldUpdate.absent();
        }
        JsonNode value = fields.get("priority");
        if (value.isNull()) {
            return FieldUpdate.of(null);
        }
        return FieldUpdate.of(parsePriority(value));
    }

    private FieldUpdate<LocalDate> dateUpdate(Map<String, JsonNode> fields) {
        if (!fields.containsKey("dueDate")) {
            return FieldUpdate.absent();
        }
        JsonNode value = fields.get("dueDate");
        if (value.isNull()) {
            return FieldUpdate.of(null);
        }
        return FieldUpdate.of(parseDueDate(value));
    }

    private Object toJavaValue(JsonNode value) {
        if (value.isObject()) {
            Map<String, Object> result = new LinkedHashMap<>();
            value.forEachEntry((key, child) -> result.put(key, toJavaValue(child)));
            return result;
        }
        if (value.isArray()) {
            ArrayList<Object> result = new ArrayList<>();
            value.forEach(child -> result.add(toJavaValue(child)));
            return result;
        }
        if (value.isNull()) {
            return null;
        }
        if (value.isString()) {
            return value.stringValue();
        }
        if (value.isBoolean()) {
            return value.booleanValue();
        }
        if (value.isNumber()) {
            return value.numberValue();
        }
        throw new TaskRequestValidationException(
                "description", "Contains an unsupported JSON value.");
    }

    private void fail(String field, String message) {
        throw new TaskRequestValidationException(field, message);
    }
}
