package com.krishnamurti.horizon.note.application;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

class NoteCreationFingerprintTest {

    @Test
    void normalizedTitleAndReorderedObjectKeysHaveTheSameFingerprint() {
        Map<String, Object> first =
                Map.of(
                        "type",
                        "doc",
                        "content",
                        List.of(Map.of("text", "body", "type", "paragraph")));
        Map<String, Object> reordered = new LinkedHashMap<>();
        reordered.put("content", List.of(Map.of("type", "paragraph", "text", "body")));
        reordered.put("type", "doc");

        assertThat(NoteCreationFingerprint.compute("  title  ", first))
                .isEqualTo(NoteCreationFingerprint.compute("title", reordered));
    }

    @Test
    void contentDifferencesChangeFingerprintAndArraysRemainOrdered() {
        Map<String, Object> first = Map.of("type", "doc", "content", List.of("one", "two"));
        Map<String, Object> reordered = Map.of("type", "doc", "content", List.of("two", "one"));

        assertThat(NoteCreationFingerprint.compute("title", first))
                .isNotEqualTo(NoteCreationFingerprint.compute("title", reordered));
        assertThat(NoteCreationFingerprint.compute("title", first))
                .isNotEqualTo(NoteCreationFingerprint.compute("other", first));
    }
}
