package com.krishnamurti.horizon.task.application;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.krishnamurti.horizon.HorizonApplication;
import com.krishnamurti.horizon.TestcontainersConfiguration;
import com.krishnamurti.horizon.tag.api.InvalidTagNameException;
import com.krishnamurti.horizon.tag.api.TagCommandApi;
import com.krishnamurti.horizon.tag.api.TagQueryApi;
import com.krishnamurti.horizon.tag.api.TagReference;
import com.krishnamurti.horizon.task.infrastructure.TaskTagAssociationRepository;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

@SpringBootTest(
        classes = HorizonApplication.class,
        properties = "spring.jpa.hibernate.ddl-auto=validate")
@Import(TestcontainersConfiguration.class)
class TaskTagAssignmentServiceIntegrationTest {

    @Autowired private TaskTagAssignmentService assignmentService;
    @Autowired private TaskTagAssociationRepository associationRepository;
    @Autowired private TagCommandApi tagCommandApi;
    @Autowired private TagQueryApi tagQueryApi;
    @Autowired private PlatformTransactionManager transactionManager;
    @Autowired private JdbcTemplate jdbcTemplate;

    @Test
    void foreignTagIdIsNotResolvedAndDoesNotChangeExistingLinks() {
        Long ownerId = createUserId();
        Long otherOwnerId = createUserId();
        Long taskId = insertTask(ownerId);
        Long existingTagId = insertTag(ownerId, "Existing");
        Long foreignTagId = insertTag(otherOwnerId, "Private");
        inTransaction(
                () ->
                        assignmentService.replace(
                                ownerId,
                                taskId,
                                java.util.List.of(new TaskTagSelection(existingTagId, null))));

        assertThatThrownBy(
                        () ->
                                inTransaction(
                                        () ->
                                                assignmentService.replace(
                                                        ownerId,
                                                        taskId,
                                                        java.util.List.of(
                                                                new TaskTagSelection(null, "Draft"),
                                                                new TaskTagSelection(
                                                                        foreignTagId, null)))))
                .isInstanceOf(TaskNotFoundException.class);

        assertThat(associationRepository.findTagIdsForTask(ownerId, taskId))
                .containsExactly(existingTagId);
        assertThat(tagExists(ownerId, "Draft")).isFalse();
    }

    @Test
    void newTagAndAssociationRollBackWhenLaterNameResolutionFails() {
        Long ownerId = createUserId();
        Long taskId = insertTask(ownerId);

        assertThatThrownBy(
                        () ->
                                inTransaction(
                                        () ->
                                                assignmentService.replace(
                                                        ownerId,
                                                        taskId,
                                                        java.util.List.of(
                                                                new TaskTagSelection(
                                                                        null, "Temporary"),
                                                                new TaskTagSelection(null, " ")))))
                .isInstanceOf(InvalidTagNameException.class);

        assertThat(tagExists(ownerId, "Temporary")).isFalse();
        assertThat(associationRepository.findTagIdsForTask(ownerId, taskId)).isEmpty();
    }

    @Test
    void concurrentReplacementLeavesOneCompleteSet() throws Exception {
        Long ownerId = createUserId();
        Long taskId = insertTask(ownerId);
        Long tagOne = insertTag(ownerId, "One");
        Long tagTwo = insertTag(ownerId, "Two");
        Long tagThree = insertTag(ownerId, "Three");
        Long tagFour = insertTag(ownerId, "Four");
        Set<Long> firstSet = Set.of(tagOne, tagTwo);
        Set<Long> secondSet = Set.of(tagThree, tagFour);
        CountDownLatch ready = new CountDownLatch(2);
        CountDownLatch start = new CountDownLatch(1);
        ExecutorService executor = Executors.newFixedThreadPool(2);

        try {
            Future<Boolean> first =
                    executor.submit(
                            () -> replaceAtSameTime(ownerId, taskId, firstSet, ready, start));
            Future<Boolean> second =
                    executor.submit(
                            () -> replaceAtSameTime(ownerId, taskId, secondSet, ready, start));

            assertThat(ready.await(10, TimeUnit.SECONDS)).isTrue();
            start.countDown();
            first.get(20, TimeUnit.SECONDS);
            second.get(20, TimeUnit.SECONDS);
        } finally {
            executor.shutdownNow();
            assertThat(executor.awaitTermination(10, TimeUnit.SECONDS)).isTrue();
        }

        assertThat(associationRepository.findTagIdsForTask(ownerId, taskId))
                .isIn(firstSet, secondSet);
    }

    @Test
    void sameResolvedSetIsNoOpAndNewNameCreatesReusableTag() {
        Long ownerId = createUserId();
        Long taskId = insertTask(ownerId);
        TagReference existing =
                new TransactionTemplate(transactionManager)
                        .execute(status -> tagCommandApi.resolveByName(ownerId, "Horizon"));
        java.util.List<TaskTagSelection> selections =
                java.util.List.of(
                        new TaskTagSelection(existing.id(), null),
                        new TaskTagSelection(null, "horizon"));
        assertThat(replaceInTransaction(ownerId, taskId, selections)).isTrue();
        assertThat(replaceInTransaction(ownerId, taskId, selections)).isFalse();

        assertThat(associationRepository.findTagIdsForTask(ownerId, taskId))
                .containsExactly(existing.id());
        assertThat(tagQueryApi.suggest(ownerId, "hor"))
                .containsExactly(new TagReference(existing.id(), "Horizon"));
    }

    private boolean replaceAtSameTime(
            Long ownerId, Long taskId, Set<Long> tagIds, CountDownLatch ready, CountDownLatch start)
            throws Exception {
        ready.countDown();
        if (!start.await(10, TimeUnit.SECONDS)) {
            throw new AssertionError("Concurrent replacement was not released.");
        }
        return new TransactionTemplate(transactionManager)
                .execute(
                        status ->
                                assignmentService.replace(
                                        ownerId,
                                        taskId,
                                        tagIds.stream()
                                                .map(id -> new TaskTagSelection(id, null))
                                                .toList()));
    }

    private void inTransaction(Runnable operation) {
        new TransactionTemplate(transactionManager).executeWithoutResult(status -> operation.run());
    }

    private boolean replaceInTransaction(
            Long ownerId, Long taskId, java.util.List<TaskTagSelection> selections) {
        return new TransactionTemplate(transactionManager)
                .execute(status -> assignmentService.replace(ownerId, taskId, selections));
    }

    private Long createUserId() {
        return jdbcTemplate.queryForObject(
                "INSERT INTO users (email, password_hash, created_at, updated_at) VALUES (?,"
                        + " 'test-hash', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) RETURNING id",
                Long.class,
                UUID.randomUUID() + "@example.com");
    }

    private Long insertTask(Long userId) {
        return jdbcTemplate.queryForObject(
                "INSERT INTO task (user_id, task_key, title, inbox, created_at, updated_at) VALUES"
                    + " (?, 'TASK-1', 'Task', TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) RETURNING"
                    + " id",
                Long.class,
                userId);
    }

    private Long insertTag(Long userId, String name) {
        return jdbcTemplate.queryForObject(
                "INSERT INTO tag (user_id, name, created_at, updated_at) "
                        + "VALUES (?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) RETURNING id",
                Long.class,
                userId,
                name);
    }

    private boolean tagExists(Long userId, String name) {
        return Boolean.TRUE.equals(
                jdbcTemplate.queryForObject(
                        "SELECT EXISTS (SELECT 1 FROM tag WHERE user_id = ? AND name = ?)",
                        Boolean.class,
                        userId,
                        name));
    }
}
