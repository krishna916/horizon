package com.krishnamurti.horizon.note.application;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.TreeMap;

/** Computes a stable digest of normalized Note creation content. */
public final class NoteCreationFingerprint {

    private static final ObjectMapper OBJECT_MAPPER = new ObjectMapper();

    private NoteCreationFingerprint() {}

    public static String compute(String normalizedTitle, Map<String, Object> normalizedContent) {
        return compute(normalizedTitle, normalizedContent, List.of());
    }

    public static String compute(
            String normalizedTitle,
            Map<String, Object> normalizedContent,
            List<NoteTagSelection> normalizedTagRefs) {
        Map<String, Object> request = new LinkedHashMap<>();
        request.put("title", normalizedTitle == null ? null : normalizedTitle.strip());
        request.put("content", canonicalize(normalizedContent));
        request.put("tags", canonicalTags(normalizedTagRefs));
        return hash(request);
    }

    public static String computeLegacyTagFree(
            String normalizedTitle, Map<String, Object> normalizedContent) {
        Map<String, Object> request = new LinkedHashMap<>();
        request.put("title", normalizedTitle == null ? null : normalizedTitle.strip());
        request.put("content", canonicalize(normalizedContent));
        return hash(request);
    }

    private static String hash(Map<String, Object> request) {
        try {
            byte[] hash =
                    MessageDigest.getInstance("SHA-256")
                            .digest(OBJECT_MAPPER.writeValueAsBytes(request));
            return java.util.HexFormat.of().formatHex(hash);
        } catch (JsonProcessingException exception) {
            throw new IllegalArgumentException(
                    "Note creation content must be JSON serializable", exception);
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException("SHA-256 is unavailable", exception);
        }
    }

    private static List<String> canonicalTags(List<NoteTagSelection> selections) {
        return selections.stream()
                .map(
                        selection ->
                                selection.id() != null
                                        ? "id:" + selection.id()
                                        : "name:" + selection.name().toLowerCase(Locale.ROOT))
                .distinct()
                .sorted()
                .toList();
    }

    private static Object canonicalize(Object value) {
        if (value instanceof Map<?, ?> map) {
            Map<String, Object> sorted = new TreeMap<>();
            map.forEach(
                    (key, nested) -> {
                        if (!(key instanceof String stringKey)) {
                            throw new IllegalArgumentException(
                                    "Note content object keys must be strings");
                        }
                        sorted.put(stringKey, canonicalize(nested));
                    });
            return sorted;
        }
        if (value instanceof List<?> list) {
            List<Object> canonical = new ArrayList<>(list.size());
            list.forEach(item -> canonical.add(canonicalize(item)));
            return canonical;
        }
        return value;
    }
}
