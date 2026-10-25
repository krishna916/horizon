package com.krishnamurti.horizon.task.infrastructure;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatExceptionOfType;

import com.krishnamurti.horizon.TestcontainersConfiguration;
import com.krishnamurti.horizon.task.domain.ChecklistItem;
import com.krishnamurti.horizon.task.domain.InvalidTaskException;
import com.krishnamurti.horizon.task.domain.Task;
import com.krishnamurti.horizon.task.domain.TaskPriority;
import com.krishnamurti.horizon.user.application.UserCommandService;
import jakarta.persistence.EntityManager;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

@SpringBootTest(properties = "spring.jpa.hibernate.ddl-auto=validate")
@Import(TestcontainersConfiguration.class)
class TaskPersistenceIntegrationTest {

    @Autowired private JdbcTemplate jdbcTemplate;
    @Autowired private UserCommandService userCommandService;
    @Autowired private TaskKeyAllocator taskKeyAllocator;
    @Autowired private TaskRepository taskRepository;
    @Autowired private ChecklistItemRepository checklistItemRepository;
    @Autowired private EntityManager entityManager;
    @Autowired private PlatformTransactionManager transactionManager;

    @Test
    void migrationCreatesTaskAndCounterTables() {
        assertThat(tableExists("task")).isTrue();
        assertThat(tableExists("task_key_counter")).isTrue();
    }

    @Test
    void migrationCreatesChecklistItemWithForeignKeyAndIndex() {
        assertThat(tableExists("checklist_item")).isTrue();
        assertThat(columnExists("checklist_item", "task_id")).isTrue();
        assertThat(columnExists("checklist_item", "due_date")).isTrue();
        assertThat(columnExists("checklist_item", "completed_at")).isTrue();
        assertThat(columnExists("checklist_item", "position")).isTrue();
        assertThat(columnExists("checklist_item", "deleted_at")).isTrue();
        assertThat(columnExists("checklist_item", "created_at")).isTrue();
        assertThat(columnExists("checklist_item", "updated_at")).isTrue();
        assertThat(constraintExists("checklist_item", "fk_checklist_item_task")).isTrue();
        assertThat(indexExists("idx_checklist_item_task_active_position")).isTrue();
    }

    @Test
    void checklistItemPersistsAndReloadsInOrderWithOptionalDate() {
        Long userId = createUserId();
        Task task = taskRepository.saveAndFlush(createTask(userId, "TASK-1", "Parent"));
        LocalDate dueDate = LocalDate.of(2026, 11, 2);
        ChecklistItem first = ChecklistItem.create(task.getId(), "  First  ", dueDate, 0);
        ChecklistItem second = ChecklistItem.create(task.getId(), "Second", null, 1);
        checklistItemRepository.saveAllAndFlush(List.of(first, second));
        entityManager.clear();

        List<ChecklistItem> reloaded =
                checklistItemRepository.findAllByTaskIdAndDeletedAtIsNullOrderByPositionAscIdAsc(
                        task.getId());

        assertThat(reloaded).extracting(ChecklistItem::getTitle).containsExactly("First", "Second");
        assertThat(reloaded).extracting(ChecklistItem::getPosition).containsExactly(0, 1);
        assertThat(reloaded).extracting(ChecklistItem::getDueDate).containsExactly(dueDate, null);
        assertThatExceptionOfType(InvalidTaskException.class)
                .isThrownBy(() -> ChecklistItem.create(task.getId(), "  ", null, 0));
        assertThatExceptionOfType(InvalidTaskException.class)
                .isThrownBy(() -> ChecklistItem.create(task.getId(), "x".repeat(256), null, 0));
    }

    @Test
    void allocationStartsAtOnePerUser() {
        Long firstUserId = createUserId();
        Long secondUserId = createUserId();

        assertThat(taskKeyAllocator.allocateNextNumber(firstUserId)).isEqualTo(1L);
        assertThat(taskKeyAllocator.allocateNextNumber(firstUserId)).isEqualTo(2L);
        assertThat(taskKeyAllocator.allocateNextNumber(secondUserId)).isEqualTo(1L);
    }

    @Test
    void concurrentAllocationsForSameUserAreUnique() throws Exception {
        Long userId = createUserId();
        ExecutorService executor = Executors.newFixedThreadPool(8);
        try {
            List<Callable<Long>> allocations =
                    java.util.stream.IntStream.range(0, 16)
                            .<Callable<Long>>mapToObj(
                                    ignored ->
                                            () ->
                                                    new TransactionTemplate(transactionManager)
                                                            .execute(
                                                                    status ->
                                                                            taskKeyAllocator
                                                                                    .allocateNextNumber(
                                                                                            userId)))
                            .toList();
            List<Future<Long>> results = executor.invokeAll(allocations);

            assertThat(results.stream().map(this::getResult).toList())
                    .containsExactlyInAnyOrderElementsOf(
                            java.util.stream.LongStream.rangeClosed(1, 16).boxed().toList());
        } finally {
            executor.shutdownNow();
        }
    }

    @Test
    void rolledBackAllocationIsNotCommitted() {
        Long userId = createUserId();
        TransactionTemplate transactionTemplate = new TransactionTemplate(transactionManager);

        transactionTemplate.executeWithoutResult(
                status -> {
                    assertThat(taskKeyAllocator.allocateNextNumber(userId)).isEqualTo(1L);
                    status.setRollbackOnly();
                });

        assertThat(taskKeyAllocator.allocateNextNumber(userId)).isEqualTo(1L);
    }

    @Test
    void persistAndReloadTitleOnly() {
        Long userId = createUserId();
        Task saved = taskRepository.saveAndFlush(createTask(userId, "TASK-1", "Title"));
        entityManager.clear();

        Task reloaded =
                taskRepository
                        .findByIdAndUserIdAndDeletedAtIsNull(saved.getId(), userId)
                        .orElseThrow();

        assertThat(reloaded.getId()).isEqualTo(saved.getId());
        assertThat(reloaded.getTaskKey()).isEqualTo("TASK-1");
        assertThat(reloaded.getTitle()).isEqualTo("Title");
        assertThat(reloaded.isInbox()).isFalse();
        assertThat(reloaded.getCreatedAt()).isNotNull();
        assertThat(reloaded.getUpdatedAt()).isNotNull();
    }

    @Test
    void jsonbAndDueDateRoundTrip() {
        Long userId = createUserId();
        Map<String, Object> description =
                Map.of(
                        "type",
                        "doc",
                        "content",
                        List.of(
                                Map.of(
                                        "type",
                                        "heading",
                                        "attrs",
                                        Map.of("level", 2),
                                        "content",
                                        List.of(Map.of("type", "text", "text", "Nested"))),
                                Map.of(
                                        "type",
                                        "paragraph",
                                        "content",
                                        List.of(
                                                Map.of(
                                                        "type",
                                                        "text",
                                                        "text",
                                                        "nested",
                                                        "marks",
                                                        List.of(Map.of("type", "bold"))))),
                                Map.of(
                                        "type",
                                        "table",
                                        "content",
                                        List.of(
                                                Map.of(
                                                        "type",
                                                        "tableRow",
                                                        "content",
                                                        List.of(
                                                                Map.of(
                                                                        "type",
                                                                        "tableCell",
                                                                        "attrs",
                                                                        Map.of(
                                                                                "colspan",
                                                                                1,
                                                                                "rowspan",
                                                                                1,
                                                                                "align",
                                                                                "center",
                                                                                "colwidth",
                                                                                List.of(80)),
                                                                        "content",
                                                                        List.of(
                                                                                Map.of(
                                                                                        "type",
                                                                                        "paragraph",
                                                                                        "content",
                                                                                        List.of(
                                                                                                Map
                                                                                                        .of(
                                                                                                                "type",
                                                                                                                "text",
                                                                                                                "text",
                                                                                                                "cell")))))))))));
        Task task =
                Task.create(
                        userId,
                        "TASK-1",
                        "Title",
                        description,
                        TaskPriority.HIGH,
                        LocalDate.of(2026, 10, 20));
        Task saved = taskRepository.saveAndFlush(task);
        entityManager.clear();

        Task reloaded =
                taskRepository
                        .findByIdAndUserIdAndDeletedAtIsNull(saved.getId(), userId)
                        .orElseThrow();

        assertThat(reloaded.getDescription()).isEqualTo(description);
        assertThat(reloaded.getPriority()).isEqualTo(TaskPriority.HIGH);
        assertThat(reloaded.getDueDate()).isEqualTo(LocalDate.of(2026, 10, 20));
    }

    @Test
    void sameKeyDifferentOwnersAllowed() {
        Long firstUserId = createUserId();
        Long secondUserId = createUserId();

        taskRepository.saveAndFlush(createTask(firstUserId, "TASK-1", "First"));
        taskRepository.saveAndFlush(createTask(secondUserId, "TASK-1", "Second"));

        assertThat(
                        taskRepository.findAllByUserIdAndDeletedAtIsNullOrderByCreatedAtDescIdDesc(
                                firstUserId))
                .extracting(Task::getTaskKey)
                .containsExactly("TASK-1");
        assertThat(
                        taskRepository.findAllByUserIdAndDeletedAtIsNullOrderByCreatedAtDescIdDesc(
                                secondUserId))
                .extracting(Task::getTaskKey)
                .containsExactly("TASK-1");
    }

    @Test
    void duplicateKeySameOwnerRejectedByDatabase() {
        Long userId = createUserId();
        taskRepository.saveAndFlush(createTask(userId, "TASK-1", "First"));

        assertThatExceptionOfType(DataIntegrityViolationException.class)
                .isThrownBy(
                        () ->
                                taskRepository.saveAndFlush(
                                        createTask(userId, "TASK-1", "Duplicate")));
    }

    @Test
    void ownerScopedGetAndListDoNotLeak() {
        Long firstUserId = createUserId();
        Long secondUserId = createUserId();
        Task firstTask = taskRepository.saveAndFlush(createTask(firstUserId, "TASK-1", "First"));
        Task secondTask = taskRepository.saveAndFlush(createTask(secondUserId, "TASK-1", "Second"));
        entityManager.clear();

        assertThat(
                        taskRepository.findByIdAndUserIdAndDeletedAtIsNull(
                                firstTask.getId(), secondUserId))
                .isEmpty();
        assertThat(
                        taskRepository.findByIdAndUserIdAndDeletedAtIsNull(
                                secondTask.getId(), firstUserId))
                .isEmpty();
        assertThat(
                        taskRepository.findAllByUserIdAndDeletedAtIsNullOrderByCreatedAtDescIdDesc(
                                firstUserId))
                .extracting(Task::getTitle)
                .containsExactly("First");
    }

    @Test
    void deletedRecordExcludedFromOrdinaryQueries() {
        Long userId = createUserId();
        Task task = taskRepository.saveAndFlush(createTask(userId, "TASK-1", "Deleted"));
        jdbcTemplate.update(
                "UPDATE task SET deleted_at = ? WHERE id = ?",
                OffsetDateTime.now(ZoneOffset.UTC),
                task.getId());
        entityManager.clear();

        assertThat(taskRepository.findByIdAndUserIdAndDeletedAtIsNull(task.getId(), userId))
                .isEmpty();
        assertThat(
                        taskRepository.findAllByUserIdAndDeletedAtIsNullOrderByCreatedAtDescIdDesc(
                                userId))
                .isEmpty();
    }

    @Test
    void softDeletedTaskDoesNotRecycleKey() {
        Long userId = createUserId();
        long firstNumber = taskKeyAllocator.allocateNextNumber(userId);
        Task task =
                taskRepository.saveAndFlush(createTask(userId, "TASK-" + firstNumber, "Deleted"));
        jdbcTemplate.update(
                "UPDATE task SET deleted_at = ? WHERE id = ?",
                OffsetDateTime.now(ZoneOffset.UTC),
                task.getId());
        long nextNumber = taskKeyAllocator.allocateNextNumber(userId);

        assertThat(nextNumber).isEqualTo(2L);
        assertThat(
                        taskRepository
                                .saveAndFlush(createTask(userId, "TASK-" + nextNumber, "Next"))
                                .getTaskKey())
                .isEqualTo("TASK-2");
    }

    @Test
    void newestFirstUsesIdTieBreaker() {
        Long userId = createUserId();
        Task first = taskRepository.saveAndFlush(createTask(userId, "TASK-1", "First"));
        Task second = taskRepository.saveAndFlush(createTask(userId, "TASK-2", "Second"));
        OffsetDateTime sameCreatedAt = OffsetDateTime.of(2026, 10, 17, 10, 0, 0, 0, ZoneOffset.UTC);
        jdbcTemplate.update(
                "UPDATE task SET created_at = ? WHERE user_id = ?", sameCreatedAt, userId);
        entityManager.clear();

        assertThat(
                        taskRepository.findAllByUserIdAndDeletedAtIsNullOrderByCreatedAtDescIdDesc(
                                userId))
                .extracting(Task::getId)
                .containsExactly(second.getId(), first.getId());
    }

    @Test
    void createdAtRemainsStableOnActualUpdate() throws InterruptedException {
        Long userId = createUserId();
        Task saved = taskRepository.saveAndFlush(createTask(userId, "TASK-1", "Before"));
        entityManager.clear();
        Task task =
                taskRepository
                        .findByIdAndUserIdAndDeletedAtIsNull(saved.getId(), userId)
                        .orElseThrow();
        OffsetDateTime createdAt = task.getCreatedAt();
        Thread.sleep(10);
        task.updateTitle("After");
        taskRepository.saveAndFlush(task);
        entityManager.clear();

        Task reloaded =
                taskRepository
                        .findByIdAndUserIdAndDeletedAtIsNull(task.getId(), userId)
                        .orElseThrow();

        assertThat(reloaded.getCreatedAt()).isEqualTo(createdAt);
        assertThat(reloaded.getUpdatedAt()).isAfter(createdAt);
    }

    @Test
    void concurrentDisjointFieldUpdatesPreserveBothChanges() throws Exception {
        Long userId = createUserId();
        Task saved =
                taskRepository.saveAndFlush(
                        Task.create(
                                userId,
                                "TASK-1",
                                "Concurrent updates",
                                null,
                                TaskPriority.MEDIUM,
                                LocalDate.of(2026, 10, 20)));
        Long taskId = saved.getId();
        entityManager.clear();
        Task original =
                taskRepository.findByIdAndUserIdAndDeletedAtIsNull(taskId, userId).orElseThrow();
        String taskKey = original.getTaskKey();
        OffsetDateTime createdAt = original.getCreatedAt();
        OffsetDateTime updatedAt = original.getUpdatedAt();
        Thread.sleep(10);
        CountDownLatch bothRowsLoaded = new CountDownLatch(2);
        CountDownLatch startUpdates = new CountDownLatch(1);
        ExecutorService executor = Executors.newFixedThreadPool(2);

        try {
            Future<?> priorityUpdate =
                    executor.submit(
                            () ->
                                    updateInSeparateTransaction(
                                            taskId,
                                            userId,
                                            bothRowsLoaded,
                                            startUpdates,
                                            task -> task.updatePriority(TaskPriority.HIGH)));
            Future<?> dueDateUpdate =
                    executor.submit(
                            () ->
                                    updateInSeparateTransaction(
                                            taskId,
                                            userId,
                                            bothRowsLoaded,
                                            startUpdates,
                                            task ->
                                                    task.updateDueDate(
                                                            LocalDate.of(2026, 10, 21))));

            assertThat(bothRowsLoaded.await(10, TimeUnit.SECONDS)).isTrue();
            startUpdates.countDown();
            priorityUpdate.get(10, TimeUnit.SECONDS);
            dueDateUpdate.get(10, TimeUnit.SECONDS);
        } finally {
            startUpdates.countDown();
            executor.shutdownNow();
            assertThat(executor.awaitTermination(10, TimeUnit.SECONDS)).isTrue();
        }

        Task reloaded =
                taskRepository.findByIdAndUserIdAndDeletedAtIsNull(taskId, userId).orElseThrow();

        assertThat(reloaded.getPriority()).isEqualTo(TaskPriority.HIGH);
        assertThat(reloaded.getDueDate()).isEqualTo(LocalDate.of(2026, 10, 21));
        assertThat(reloaded.getId()).isEqualTo(taskId);
        assertThat(reloaded.getTaskKey()).isEqualTo(taskKey);
        assertThat(reloaded.getUserId()).isEqualTo(userId);
        assertThat(reloaded.getCreatedAt()).isEqualTo(createdAt);
        assertThat(reloaded.getUpdatedAt()).isAfter(updatedAt);
    }

    private void updateInSeparateTransaction(
            Long taskId,
            Long userId,
            CountDownLatch bothRowsLoaded,
            CountDownLatch startUpdates,
            java.util.function.Consumer<Task> update) {
        new TransactionTemplate(transactionManager)
                .executeWithoutResult(
                        status -> {
                            Task task =
                                    taskRepository
                                            .findByIdAndUserIdAndDeletedAtIsNull(taskId, userId)
                                            .orElseThrow();
                            bothRowsLoaded.countDown();
                            try {
                                if (!startUpdates.await(10, TimeUnit.SECONDS)) {
                                    throw new AssertionError(
                                            "Timed out waiting to start task updates");
                                }
                            } catch (InterruptedException exception) {
                                Thread.currentThread().interrupt();
                                throw new AssertionError(
                                        "Interrupted while waiting to update task", exception);
                            }
                            update.accept(task);
                            taskRepository.saveAndFlush(task);
                        });
    }

    private Task createTask(Long userId, String key, String title) {
        return Task.create(userId, key, title, null, null, null);
    }

    private Long getResult(Future<Long> result) {
        try {
            return result.get();
        } catch (Exception exception) {
            throw new AssertionError("Concurrent task key allocation failed", exception);
        }
    }

    private Long createUserId() {
        return userCommandService.register(UUID.randomUUID() + "@example.com", "Password123!").id();
    }

    private boolean tableExists(String tableName) {
        return Boolean.TRUE.equals(
                jdbcTemplate.queryForObject(
                        "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name ="
                                + " ?)",
                        Boolean.class,
                        tableName));
    }

    private boolean columnExists(String tableName, String columnName) {
        return Boolean.TRUE.equals(
                jdbcTemplate.queryForObject(
                        "SELECT EXISTS (SELECT FROM information_schema.columns WHERE table_name = ?"
                                + " AND column_name = ?)",
                        Boolean.class,
                        tableName,
                        columnName));
    }

    private boolean constraintExists(String tableName, String constraintName) {
        return Boolean.TRUE.equals(
                jdbcTemplate.queryForObject(
                        "SELECT EXISTS (SELECT FROM information_schema.table_constraints WHERE"
                                + " table_name = ? AND constraint_name = ?)",
                        Boolean.class,
                        tableName,
                        constraintName));
    }

    private boolean indexExists(String indexName) {
        return Boolean.TRUE.equals(
                jdbcTemplate.queryForObject(
                        "SELECT EXISTS (SELECT FROM pg_indexes WHERE indexname = ?)",
                        Boolean.class,
                        indexName));
    }
}
