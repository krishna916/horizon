package com.krishnamurti.horizon.task.application;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.krishnamurti.horizon.TestcontainersConfiguration;
import com.krishnamurti.horizon.task.domain.InvalidTaskException;
import com.krishnamurti.horizon.task.domain.Task;
import com.krishnamurti.horizon.user.application.UserCommandService;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
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
class IdempotentTaskCreationServiceTest {

    @Autowired private IdempotentTaskCreationService idempotentTaskCreationService;
    @Autowired private UserCommandService userCommandService;
    @Autowired private JdbcTemplate jdbcTemplate;

    @AfterEach
    void clearSecurityContext() {
        SecurityContextHolder.clearContext();
    }

    @Test
    void repeatedRequestReturnsSameTaskWithoutAllocatingAnotherKey() {
        Long userId = createUserId();
        UUID requestKey = UUID.randomUUID();
        Map<String, Object> description = Map.of("type", "doc", "content", List.of());
        authenticateAs(userId);

        Task created =
                idempotentTaskCreationService.create(requestKey, "Title", description, null, null);
        Task replayed =
                idempotentTaskCreationService.create(requestKey, "Title", description, null, null);

        assertThat(replayed.getId()).isEqualTo(created.getId());
        assertThat(replayed.getTaskKey()).isEqualTo("TASK-1");
        assertThat(taskCount(userId)).isEqualTo(1L);
        assertThat(counterValue(userId)).isEqualTo(1L);
    }

    @Test
    void differentRequestKeyCreatesNextTaskNumber() {
        Long userId = createUserId();
        authenticateAs(userId);

        Task first =
                idempotentTaskCreationService.create(UUID.randomUUID(), "First", null, null, null);
        Task second =
                idempotentTaskCreationService.create(UUID.randomUUID(), "Second", null, null, null);

        assertThat(first.getTaskKey()).isEqualTo("TASK-1");
        assertThat(second.getTaskKey()).isEqualTo("TASK-2");
        assertThat(taskCount(userId)).isEqualTo(2L);
    }

    @Test
    void anotherUserCanUseTheSameRequestKeyIndependently() {
        Long firstUserId = createUserId();
        Long secondUserId = createUserId();
        UUID requestKey = UUID.randomUUID();

        authenticateAs(firstUserId);
        Task first = idempotentTaskCreationService.create(requestKey, "First", null, null, null);
        authenticateAs(secondUserId);
        Task second = idempotentTaskCreationService.create(requestKey, "Second", null, null, null);

        assertThat(first.getId()).isNotEqualTo(second.getId());
        assertThat(first.getTaskKey()).isEqualTo("TASK-1");
        assertThat(second.getTaskKey()).isEqualTo("TASK-1");
        assertThat(taskCount(firstUserId)).isEqualTo(1L);
        assertThat(taskCount(secondUserId)).isEqualTo(1L);
    }

    @Test
    void reusedKeyWithDifferentBodyIsAConflict() {
        Long userId = createUserId();
        UUID requestKey = UUID.randomUUID();
        authenticateAs(userId);
        idempotentTaskCreationService.create(requestKey, "Original", null, null, null);

        assertThatThrownBy(
                        () ->
                                idempotentTaskCreationService.create(
                                        requestKey, "Changed", null, null, null))
                .isInstanceOf(TaskCreationConflictException.class);
        assertThat(taskCount(userId)).isEqualTo(1L);
        assertThat(counterValue(userId)).isEqualTo(1L);
    }

    @Test
    void invalidTitleRollsBackRequestClaimAndTaskNumber() {
        Long userId = createUserId();
        UUID requestKey = UUID.randomUUID();
        authenticateAs(userId);

        assertThatThrownBy(
                        () ->
                                idempotentTaskCreationService.create(
                                        requestKey,
                                        "  ",
                                        null,
                                        null,
                                        LocalDate.parse("2026-10-20")))
                .isInstanceOf(InvalidTaskException.class);

        assertThat(taskCount(userId)).isZero();
        assertThat(
                        jdbcTemplate.queryForObject(
                                "SELECT COUNT(*) FROM task_creation_request WHERE user_id = ? AND"
                                        + " request_key = ?",
                                Long.class,
                                userId,
                                requestKey))
                .isZero();
        assertThat(
                        jdbcTemplate.queryForObject(
                                "SELECT COUNT(*) FROM task_key_counter WHERE user_id = ?",
                                Long.class,
                                userId))
                .isZero();
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

    private Long taskCount(Long userId) {
        return jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM task WHERE user_id = ?", Long.class, userId);
    }

    private Long counterValue(Long userId) {
        return jdbcTemplate.queryForObject(
                "SELECT last_allocated FROM task_key_counter WHERE user_id = ?",
                Long.class,
                userId);
    }
}
