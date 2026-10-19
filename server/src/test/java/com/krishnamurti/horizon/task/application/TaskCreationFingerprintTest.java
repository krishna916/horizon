package com.krishnamurti.horizon.task.application;

import static org.assertj.core.api.Assertions.assertThat;

import com.krishnamurti.horizon.task.domain.TaskPriority;
import java.time.LocalDate;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

class TaskCreationFingerprintTest {

    @Test
    void trimsTitleAndTreatsMissingOptionalValuesAsNull() {
        String withWhitespace = TaskCreationFingerprint.compute(" Task ", null, null, null);
        String withoutWhitespace = TaskCreationFingerprint.compute("Task", null, null, null);

        assertThat(withWhitespace).isEqualTo(withoutWhitespace);
    }

    @Test
    void sortsNestedObjectKeysWithoutChangingArrayOrder() {
        Map<String, Object> firstDescription =
                Map.of(
                        "type",
                        "doc",
                        "content",
                        List.of(Map.of("type", "paragraph", "attrs", Map.of("b", 2, "a", 1))));
        Map<String, Object> secondDescription =
                Map.of(
                        "content",
                        List.of(Map.of("attrs", Map.of("a", 1, "b", 2), "type", "paragraph")),
                        "type",
                        "doc");

        assertThat(TaskCreationFingerprint.compute("Task", firstDescription, null, null))
                .isEqualTo(TaskCreationFingerprint.compute("Task", secondDescription, null, null));
    }

    @Test
    void changesFingerprintWhenAnyMeaningfulCreationFieldChanges() {
        Map<String, Object> description = new LinkedHashMap<>();
        description.put("type", "doc");
        description.put("content", List.of(Map.of("type", "paragraph")));
        String baseline =
                TaskCreationFingerprint.compute(
                        "Task", description, TaskPriority.HIGH, LocalDate.parse("2026-10-20"));

        assertThat(
                        TaskCreationFingerprint.compute(
                                "Other",
                                description,
                                TaskPriority.HIGH,
                                LocalDate.parse("2026-10-20")))
                .isNotEqualTo(baseline);
        assertThat(
                        TaskCreationFingerprint.compute(
                                "Task",
                                Map.of("type", "doc", "content", List.of()),
                                TaskPriority.HIGH,
                                LocalDate.parse("2026-10-20")))
                .isNotEqualTo(baseline);
        assertThat(
                        TaskCreationFingerprint.compute(
                                "Task",
                                description,
                                TaskPriority.LOW,
                                LocalDate.parse("2026-10-20")))
                .isNotEqualTo(baseline);
        assertThat(
                        TaskCreationFingerprint.compute(
                                "Task",
                                description,
                                TaskPriority.HIGH,
                                LocalDate.parse("2026-10-21")))
                .isNotEqualTo(baseline);
    }
}
