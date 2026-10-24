package com.krishnamurti.horizon.task.application;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.krishnamurti.horizon.task.domain.TaskPriority;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;

/** Creates a stable digest for the meaningful fields of a task creation request. */
public final class TaskCreationFingerprint {

    private static final ObjectMapper OBJECT_MAPPER = new ObjectMapper();

    private TaskCreationFingerprint() {}

    public static String compute(
            String normalizedTitle,
            Map<String, Object> description,
            TaskPriority priority,
            LocalDate dueDate) {
        return compute(normalizedTitle, description, priority, dueDate, List.of());
    }

    public static String compute(
            String normalizedTitle,
            Map<String, Object> description,
            TaskPriority priority,
            LocalDate dueDate,
            List<InitialChecklistItem> checklist) {
        Map<String, Object> canonicalRequest = new LinkedHashMap<>();
        canonicalRequest.put("title", normalizedTitle == null ? null : normalizedTitle.strip());
        canonicalRequest.put("description", canonicalize(description));
        canonicalRequest.put("priority", priority == null ? null : priority.name());
        canonicalRequest.put("dueDate", dueDate == null ? null : dueDate.toString());
        List<Map<String, Object>> canonicalChecklist =
                checklist == null
                        ? List.of()
                        : checklist.stream()
                                .map(
                                        item -> {
                                            Map<String, Object> child = new LinkedHashMap<>();
                                            child.put("title", item.title().strip());
                                            child.put(
                                                    "dueDate",
                                                    item.dueDate() == null
                                                            ? null
                                                            : item.dueDate().toString());
                                            return child;
                                        })
                                .toList();
        canonicalRequest.put("checklist", canonicalChecklist);

        try {
            byte[] canonicalBytes = OBJECT_MAPPER.writeValueAsBytes(canonicalRequest);
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(canonicalBytes);
            return java.util.HexFormat.of().formatHex(digest);
        } catch (JsonProcessingException exception) {
            throw new IllegalArgumentException(
                    "Task creation request must contain JSON values.", exception);
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException("SHA-256 is unavailable.", exception);
        }
    }

    private static Object canonicalize(Object value) {
        if (value instanceof Map<?, ?> map) {
            Map<String, Object> sorted = new TreeMap<>();
            map.forEach(
                    (key, nestedValue) -> {
                        if (!(key instanceof String stringKey)) {
                            throw new IllegalArgumentException(
                                    "Task creation request objects must use string keys.");
                        }
                        sorted.put(stringKey, canonicalize(nestedValue));
                    });
            return sorted;
        }
        if (value instanceof List<?> list) {
            List<Object> canonicalList = new ArrayList<>(list.size());
            list.forEach(item -> canonicalList.add(canonicalize(item)));
            return canonicalList;
        }
        return value;
    }
}
