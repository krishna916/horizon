package com.krishnamurti.horizon.note.web;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Deep immutable defensive copies for JSON response/request DTOs. */
final class NoteJsonCopy {

    private NoteJsonCopy() {}

    @SuppressWarnings("unchecked")
    static Map<String, Object> immutableMap(Map<String, Object> source) {
        if (source == null) return null;
        return (Map<String, Object>) copy(source);
    }

    private static Object copy(Object value) {
        if (value instanceof Map<?, ?> map) {
            Map<String, Object> result = new LinkedHashMap<>();
            map.forEach((key, nested) -> result.put((String) key, copy(nested)));
            return Collections.unmodifiableMap(result);
        }
        if (value instanceof List<?> list) {
            List<Object> result = new ArrayList<>(list.size());
            list.forEach(nested -> result.add(copy(nested)));
            return Collections.unmodifiableList(result);
        }
        return value;
    }
}
