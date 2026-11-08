package com.krishnamurti.horizon.note.web;

import com.krishnamurti.horizon.note.application.FieldUpdate;
import com.krishnamurti.horizon.note.application.NoteCollection;
import com.krishnamurti.horizon.note.application.NotePatch;
import com.krishnamurti.horizon.note.application.NoteSort;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;

/** Validates Note JSON/query shapes and converts them to application input. */
@Component
public class NoteRequestMapper {

    private static final String TITLE_FIELD = "title";
    private static final String CONTENT_FIELD = "content";
    private static final String EXPECTED_VERSION_FIELD = "expectedVersion";
    private static final Set<String> MUTABLE_FIELDS = Set.of(TITLE_FIELD, CONTENT_FIELD);

    public UUID parseIdempotencyKey(String value) {
        if (value == null) fail("Idempotency-Key", "A canonical UUID is required.");
        try {
            UUID key = UUID.fromString(value);
            if (!key.toString().equals(value)) fail("Idempotency-Key", "Must be a canonical UUID.");
            return key;
        } catch (IllegalArgumentException exception) {
            throw new NoteRequestValidationException(
                    "Idempotency-Key", "Must be a canonical UUID.");
        }
    }

    public CreateFields toCreate(CreateNoteRequest request) {
        Map<String, JsonNode> fields = request.fields();
        rejectUnknown(fields, MUTABLE_FIELDS);
        return new CreateFields(title(fields, TITLE_FIELD), content(fields, CONTENT_FIELD));
    }

    public NotePatch toPatch(UpdateNoteRequest request) {
        Map<String, JsonNode> fields = request.fields();
        rejectUnknown(fields, Set.of(EXPECTED_VERSION_FIELD, TITLE_FIELD, CONTENT_FIELD));
        JsonNode expected = fields.get(EXPECTED_VERSION_FIELD);
        if (expected == null || !expected.isIntegralNumber() || !expected.canConvertToLong()) {
            fail(EXPECTED_VERSION_FIELD, "A nonnegative integer is required.");
        }
        long version = expected.longValue();
        if (version < 0) fail(EXPECTED_VERSION_FIELD, "A nonnegative integer is required.");
        return new NotePatch(
                version,
                fields.containsKey(TITLE_FIELD)
                        ? FieldUpdate.of(title(fields, TITLE_FIELD))
                        : FieldUpdate.absent(),
                fields.containsKey(CONTENT_FIELD)
                        ? FieldUpdate.of(content(fields, CONTENT_FIELD))
                        : FieldUpdate.absent());
    }

    public NoteCollection parseCollection(String value) {
        String normalized = value == null ? "active" : value;
        return switch (normalized) {
            case "active" -> NoteCollection.ACTIVE;
            case "archived" -> NoteCollection.ARCHIVED;
            default ->
                    throw new NoteRequestValidationException(
                            "collection", "Must be active or archived.");
        };
    }

    public NoteSort parseSort(String value) {
        String normalized = value == null ? "updated_desc" : value;
        return switch (normalized) {
            case "updated_desc" -> NoteSort.UPDATED_DESC;
            case "updated_asc" -> NoteSort.UPDATED_ASC;
            case "title_asc" -> NoteSort.TITLE_ASC;
            default -> throw new NoteRequestValidationException("sort", "Unsupported Note sort.");
        };
    }

    public int parsePage(String value, int defaultValue, String field, int minimum, int maximum) {
        if (value == null) return defaultValue;
        try {
            int parsed = Integer.parseInt(value);
            if (parsed < minimum || parsed > maximum) throw new NumberFormatException();
            return parsed;
        } catch (NumberFormatException exception) {
            throw new NoteRequestValidationException(
                    field, "Must be an integer from " + minimum + " to " + maximum + ".");
        }
    }

    public void validateOffset(int page, int size) {
        try {
            Math.multiplyExact(page, size);
        } catch (ArithmeticException exception) {
            throw new NoteRequestValidationException(
                    "page", "The requested page offset is too large.");
        }
    }

    private String title(Map<String, JsonNode> fields, String field) {
        JsonNode value = fields.get(field);
        if (value == null || value.isNull()) return null;
        if (!value.isString()) fail(field, "Must be a string or null.");
        return value.stringValue();
    }

    private Map<String, Object> content(Map<String, JsonNode> fields, String field) {
        JsonNode value = fields.get(field);
        if (value == null || value.isNull()) return null;
        if (!value.isObject()) fail(field, "Must be a Tiptap document object or null.");
        Object converted = toJavaValue(value, field);
        @SuppressWarnings("unchecked")
        Map<String, Object> document = (Map<String, Object>) converted;
        return document;
    }

    private Object toJavaValue(JsonNode value, String field) {
        if (value.isObject()) {
            Map<String, Object> result = new LinkedHashMap<>();
            value.forEachEntry((key, child) -> result.put(key, toJavaValue(child, field)));
            return result;
        }
        if (value.isArray()) {
            ArrayList<Object> result = new ArrayList<>();
            value.forEach(child -> result.add(toJavaValue(child, field)));
            return result;
        }
        if (value.isNull()) return null;
        if (value.isString()) return value.stringValue();
        if (value.isBoolean()) return value.booleanValue();
        if (value.isNumber()) return value.numberValue();
        fail(field, "Contains an unsupported JSON value.");
        throw new IllegalStateException("unreachable");
    }

    private void rejectUnknown(Map<String, JsonNode> fields, Set<String> allowed) {
        fields.keySet().stream()
                .filter(field -> !allowed.contains(field))
                .findFirst()
                .ifPresent(field -> fail(field, "Field is not supported."));
    }

    private void fail(String field, String message) {
        throw new NoteRequestValidationException(field, message);
    }

    public record CreateFields(String title, Map<String, Object> content) {
        public CreateFields {
            content = NoteJsonCopy.immutableMap(content);
        }

        @Override
        @edu.umd.cs.findbugs.annotations.SuppressFBWarnings(
                value = "EI_EXPOSE_REP",
                justification = "The returned JSON graph was copied deeply and wrapped immutable.")
        public Map<String, Object> content() {
            return content;
        }
    }
}
