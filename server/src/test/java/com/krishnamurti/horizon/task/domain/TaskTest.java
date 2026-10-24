package com.krishnamurti.horizon.task.domain;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

class TaskTest {

    @Test
    void createTitleOnlyNormalizesAndDefaultsInboxFalse() {
        Task task = Task.create(7L, "TASK-1", "  Renew passport  ", null, null, null);

        assertThat(task.getUserId()).isEqualTo(7L);
        assertThat(task.getTaskKey()).isEqualTo("TASK-1");
        assertThat(task.getTitle()).isEqualTo("Renew passport");
        assertThat(task.getDescription()).isNull();
        assertThat(task.isInbox()).isFalse();
    }

    @Test
    void rejectBlankOrOversizeTitle() {
        assertThatThrownBy(() -> Task.create(7L, "TASK-1", "  \t ", null, null, null))
                .isInstanceOf(InvalidTaskException.class)
                .hasMessageContaining("title");
        assertThatThrownBy(() -> Task.create(7L, "TASK-1", "x".repeat(256), null, null, null))
                .isInstanceOf(InvalidTaskException.class)
                .hasMessageContaining("title");
    }

    @Test
    void preserveCapitalizationAndInternalSpaces() {
        Task task = Task.create(7L, "TASK-1", "  Call  Dr. O'Neil  ", null, null, null);

        assertThat(task.getTitle()).isEqualTo("Call  Dr. O'Neil");
    }

    @Test
    void validateDocEnvelopeAndPreserveNestedContent() {
        Map<String, Object> content =
                Map.of(
                        "type",
                        "doc",
                        "content",
                        List.of(
                                Map.of(
                                        "type",
                                        "paragraph",
                                        "content",
                                        List.of(Map.of("type", "text", "text", "Hi")))));
        Task task = Task.create(7L, "TASK-1", "Title", content, null, null);

        assertThat(task.getDescription()).isEqualTo(content);
        assertThatThrownBy(
                        () ->
                                Task.create(
                                        7L,
                                        "TASK-2",
                                        "Title",
                                        Map.of("type", "paragraph", "content", List.of()),
                                        null,
                                        null))
                .isInstanceOfSatisfying(
                        InvalidTaskException.class,
                        exception -> assertThat(exception.getField()).isEqualTo("description"));
        assertThatThrownBy(
                        () ->
                                Task.create(
                                        7L,
                                        "TASK-2",
                                        "Title",
                                        Map.of("type", "doc", "content", "not-an-array"),
                                        null,
                                        null))
                .isInstanceOfSatisfying(
                        InvalidTaskException.class,
                        exception -> assertThat(exception.getField()).isEqualTo("description"));
    }

    @Test
    void optionalMetadataCanBeCleared() {
        Task task =
                Task.create(
                        7L,
                        "TASK-1",
                        "Title",
                        Map.of("type", "doc", "content", List.of()),
                        TaskPriority.HIGH,
                        LocalDate.of(2026, 10, 20));

        task.updateDescription(null);
        task.updatePriority(null);
        task.updateDueDate(null);

        assertThat(task.getDescription()).isNull();
        assertThat(task.getPriority()).isNull();
        assertThat(task.getDueDate()).isNull();
    }

    @Test
    void identitySurvivesSupportedDomainOperations() {
        Task task = Task.create(7L, "TASK-1", "Before", null, null, null);
        OffsetDateTime createdAt = OffsetDateTime.of(2026, 10, 17, 10, 0, 0, 0, ZoneOffset.UTC);
        task.setId(42L);
        task.setCreatedAt(createdAt);
        task.updateTitle("  After  ");
        task.updatePriority(TaskPriority.CRITICAL);
        task.updateDueDate(LocalDate.of(2026, 10, 21));

        assertThat(task.getId()).isEqualTo(42L);
        assertThat(task.getUserId()).isEqualTo(7L);
        assertThat(task.getTaskKey()).isEqualTo("TASK-1");
        assertThat(task.getCreatedAt()).isEqualTo(createdAt);
        assertThat(task.getTitle()).isEqualTo("After");
        assertThat(task.getPriority()).isEqualTo(TaskPriority.CRITICAL);
        assertThat(task.getDueDate()).isEqualTo(LocalDate.of(2026, 10, 21));
    }

    @Test
    void priorityCodesDoNotDependOnEnumOrdinals() {
        TaskPriorityConverter converter = new TaskPriorityConverter();

        assertThat(converter.convertToDatabaseColumn(TaskPriority.CRITICAL)).isEqualTo((short) 1);
        assertThat(converter.convertToDatabaseColumn(TaskPriority.HIGH)).isEqualTo((short) 2);
        assertThat(converter.convertToDatabaseColumn(TaskPriority.MEDIUM)).isEqualTo((short) 3);
        assertThat(converter.convertToDatabaseColumn(TaskPriority.LOW)).isEqualTo((short) 4);
    }

    @Test
    void archiveAndRestorePreserveCompletionAndOtherTaskFacts() {
        Task task =
                Task.create(
                        7L,
                        "TASK-1",
                        "Preserved",
                        null,
                        TaskPriority.HIGH,
                        LocalDate.of(2026, 10, 24));
        OffsetDateTime completedAt = OffsetDateTime.parse("2026-10-20T12:00:00Z");
        OffsetDateTime archivedAt = OffsetDateTime.parse("2026-10-21T12:00:00Z");
        task.complete(completedAt);

        task.archive(archivedAt);
        task.archive(archivedAt.plusDays(1));

        assertThat(task.getArchivedAt()).isEqualTo(archivedAt);
        assertThat(task.getCompletedAt()).isEqualTo(completedAt);
        assertThat(task.getTitle()).isEqualTo("Preserved");
        assertThat(task.getPriority()).isEqualTo(TaskPriority.HIGH);
        assertThat(task.getDueDate()).isEqualTo(LocalDate.of(2026, 10, 24));

        task.restoreArchived();

        assertThat(task.getArchivedAt()).isNull();
        assertThat(task.getCompletedAt()).isEqualTo(completedAt);
    }

    @Test
    void softDeleteAndRestorePreserveArchiveCompletionAndTaskFacts() {
        Task task = Task.create(7L, "TASK-1", "Preserved", null, null, null);
        OffsetDateTime completedAt = OffsetDateTime.parse("2026-10-20T12:00:00Z");
        OffsetDateTime archivedAt = OffsetDateTime.parse("2026-10-21T12:00:00Z");
        OffsetDateTime deletedAt = OffsetDateTime.parse("2026-10-22T12:00:00Z");
        task.complete(completedAt);
        task.archive(archivedAt);

        task.softDelete(deletedAt);
        task.softDelete(deletedAt.plusDays(1));

        assertThat(task.getDeletedAt()).isEqualTo(deletedAt);
        assertThat(task.getArchivedAt()).isEqualTo(archivedAt);
        assertThat(task.getCompletedAt()).isEqualTo(completedAt);
        assertThat(task.getTitle()).isEqualTo("Preserved");

        task.restoreDeleted();

        assertThat(task.getDeletedAt()).isNull();
        assertThat(task.getArchivedAt()).isEqualTo(archivedAt);
        assertThat(task.getCompletedAt()).isEqualTo(completedAt);
    }
}
