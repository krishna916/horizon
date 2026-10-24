package com.krishnamurti.horizon.task.application;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.krishnamurti.horizon.TestcontainersConfiguration;
import com.krishnamurti.horizon.task.domain.InvalidTaskException;
import com.krishnamurti.horizon.task.domain.Task;
import com.krishnamurti.horizon.task.domain.TaskPriority;
import com.krishnamurti.horizon.user.application.UserCommandService;
import jakarta.persistence.EntityManager;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;

@SpringBootTest(properties = "spring.jpa.hibernate.ddl-auto=validate")
@Import(TestcontainersConfiguration.class)
class TaskCommandServiceTest {

    @Autowired private TaskCommandService taskCommandService;
    @Autowired private TaskQueryService taskQueryService;
    @Autowired private UserCommandService userCommandService;
    @Autowired private JdbcTemplate jdbcTemplate;
    @Autowired private EntityManager entityManager;

    private Long firstUserId;
    private Long secondUserId;

    @BeforeEach
    void setUpUsers() {
        firstUserId = createUserId();
        secondUserId = createUserId();
        authenticateAs(firstUserId);
    }

    @AfterEach
    void clearSecurityContext() {
        SecurityContextHolder.clearContext();
    }

    @Test
    void createAllocatesKeyOnceAndSavesAsInboxFalse() {
        Task first = taskCommandService.create("  First task  ", null, null, null);
        Task second = taskCommandService.create("Second task", null, null, null);

        assertThat(first.getTaskKey()).isEqualTo("TASK-1");
        assertThat(first.getTitle()).isEqualTo("First task");
        assertThat(first.isInbox()).isFalse();
        assertThat(second.getTaskKey()).isEqualTo("TASK-2");
        assertThat(
                        jdbcTemplate.queryForObject(
                                "SELECT last_allocated FROM task_key_counter WHERE user_id = ?",
                                Long.class,
                                firstUserId))
                .isEqualTo(2L);
    }

    @Test
    void createFailureRollsBack() {
        assertThatThrownBy(() -> taskCommandService.create("  ", null, null, null))
                .isInstanceOf(InvalidTaskException.class);

        assertThat(counterRowsFor(firstUserId)).isZero();
        assertThat(taskCommandService.create("After failed create", null, null, null).getTaskKey())
                .isEqualTo("TASK-1");
    }

    @Test
    void getAndListAlwaysUseCurrentOwner() {
        Task first = taskCommandService.create("First owner's task", null, null, null);
        authenticateAs(secondUserId);
        Task second = taskCommandService.create("Second owner's task", null, null, null);
        authenticateAs(firstUserId);

        assertThat(taskQueryService.get(first.getId()).getTitle()).isEqualTo("First owner's task");
        assertThatThrownBy(() -> taskQueryService.get(second.getId()))
                .isInstanceOf(TaskNotFoundException.class)
                .hasMessage("Task not found");
        assertThat(taskQueryService.list())
                .extracting(Task::getTitle)
                .containsExactly("First owner's task");
    }

    @Test
    void updateOnlyPresentFields() {
        Map<String, Object> description =
                Map.of(
                        "type",
                        "doc",
                        "content",
                        List.of(
                                Map.of(
                                        "type",
                                        "paragraph",
                                        "content",
                                        List.of(Map.of("type", "text", "text", "Keep this")))));
        Task created =
                taskCommandService.create(
                        "Before", description, TaskPriority.HIGH, LocalDate.of(2026, 10, 20));
        Task updated =
                taskCommandService.update(
                        created.getId(),
                        new TaskPatch(
                                FieldUpdate.of("After"),
                                FieldUpdate.absent(),
                                FieldUpdate.absent(),
                                FieldUpdate.absent()));

        assertThat(updated.getTitle()).isEqualTo("After");
        assertThat(updated.getDescription()).isEqualTo(description);
        assertThat(updated.getPriority()).isEqualTo(TaskPriority.HIGH);
        assertThat(updated.getDueDate()).isEqualTo(LocalDate.of(2026, 10, 20));
    }

    @Test
    void explicitNullClearsOptionalField() {
        Task created =
                taskCommandService.create(
                        "Before",
                        Map.of("type", "doc", "content", List.of()),
                        TaskPriority.HIGH,
                        LocalDate.of(2026, 10, 20));
        Task updated =
                taskCommandService.update(
                        created.getId(),
                        new TaskPatch(
                                FieldUpdate.absent(),
                                FieldUpdate.of(null),
                                FieldUpdate.of(null),
                                FieldUpdate.of(null)));

        assertThat(updated.getDescription()).isNull();
        assertThat(updated.getPriority()).isNull();
        assertThat(updated.getDueDate()).isNull();
    }

    @Test
    void missingOrOtherOwnerThrowsSameTaskNotFound() {
        authenticateAs(secondUserId);
        Task otherTask = taskCommandService.create("Other owner", null, null, null);
        authenticateAs(firstUserId);

        assertThatThrownBy(() -> taskQueryService.get(otherTask.getId()))
                .isInstanceOf(TaskNotFoundException.class)
                .hasMessage("Task not found");
        assertThatThrownBy(() -> taskQueryService.get(Long.MAX_VALUE))
                .isInstanceOf(TaskNotFoundException.class)
                .hasMessage("Task not found");
    }

    @Test
    void immutableMetadataDoesNotChange() {
        Task created = taskCommandService.create("Before", null, null, null);
        Long id = created.getId();
        entityManager.clear();
        Task persisted = taskQueryService.get(id);
        String key = persisted.getTaskKey();
        Long ownerId = persisted.getUserId();
        OffsetDateTime createdAt = persisted.getCreatedAt();

        Task updated =
                taskCommandService.update(
                        id,
                        new TaskPatch(
                                FieldUpdate.of("After"),
                                FieldUpdate.absent(),
                                FieldUpdate.absent(),
                                FieldUpdate.absent()));

        assertThat(updated.getId()).isEqualTo(id);
        assertThat(updated.getTaskKey()).isEqualTo(key);
        assertThat(updated.getUserId()).isEqualTo(ownerId);
        assertThat(updated.getCreatedAt()).isEqualTo(createdAt);
    }

    @Test
    void updatedAtOnPersistedChange() throws InterruptedException {
        Task created = taskCommandService.create("Before", null, null, null);
        Long id = created.getId();
        entityManager.clear();
        Task persisted = taskQueryService.get(id);
        OffsetDateTime createdAt = persisted.getCreatedAt();
        OffsetDateTime originalUpdatedAt = persisted.getUpdatedAt();
        Thread.sleep(10);

        Task updated =
                taskCommandService.update(
                        id,
                        new TaskPatch(
                                FieldUpdate.of("After"),
                                FieldUpdate.absent(),
                                FieldUpdate.absent(),
                                FieldUpdate.absent()));

        assertThat(updated.getCreatedAt()).isEqualTo(createdAt);
        assertThat(updated.getUpdatedAt()).isAfter(originalUpdatedAt);
    }

    private Long createUserId() {
        return userCommandService.register(UUID.randomUUID() + "@example.com", "Password123!").id();
    }

    private void authenticateAs(Long userId) {
        SecurityContextHolder.getContext()
                .setAuthentication(
                        new UsernamePasswordAuthenticationToken(
                                userId, null, List.of(new SimpleGrantedAuthority("ROLE_USER"))));
    }

    private long counterRowsFor(Long userId) {
        return jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM task_key_counter WHERE user_id = ?", Long.class, userId);
    }
}
