package com.krishnamurti.horizon.task.infrastructure;

import static org.assertj.core.api.Assertions.assertThat;

import com.krishnamurti.horizon.TestcontainersConfiguration;
import com.krishnamurti.horizon.user.application.UserCommandService;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

@SpringBootTest(properties = "spring.jpa.hibernate.ddl-auto=validate")
@Import(TestcontainersConfiguration.class)
class TaskPersistenceIntegrationTest {

    @Autowired private JdbcTemplate jdbcTemplate;
    @Autowired private UserCommandService userCommandService;
    @Autowired private TaskKeyAllocator taskKeyAllocator;
    @Autowired private PlatformTransactionManager transactionManager;

    @Test
    void migrationCreatesTaskAndCounterTables() {
        assertThat(tableExists("task")).isTrue();
        assertThat(tableExists("task_key_counter")).isTrue();
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
}
