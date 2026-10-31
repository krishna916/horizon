package com.krishnamurti.horizon.tag.infrastructure;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.krishnamurti.horizon.HorizonApplication;
import com.krishnamurti.horizon.TestcontainersConfiguration;
import java.sql.SQLException;
import java.util.List;
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
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

@SpringBootTest(
        classes = HorizonApplication.class,
        properties = "spring.jpa.hibernate.ddl-auto=validate")
@Import(TestcontainersConfiguration.class)
class TagSchemaIntegrationTest {

    @Autowired private JdbcTemplate jdbcTemplate;
    @Autowired private PlatformTransactionManager transactionManager;

    @Test
    void schemaHasRequiredColumnsAndIndex() {
        assertThat(
                        jdbcTemplate.queryForList(
                                "SELECT column_name FROM information_schema.columns WHERE"
                                        + " table_schema = current_schema() AND table_name = 'tag'"
                                        + " ORDER BY ordinal_position",
                                String.class))
                .containsExactly("id", "user_id", "name", "created_at", "updated_at");

        String indexDefinition =
                jdbcTemplate.queryForObject(
                        "SELECT indexdef FROM pg_indexes "
                                + "WHERE schemaname = current_schema() AND indexname = ?",
                        String.class,
                        "uk_tag_user_name_ci");
        assertThat(indexDefinition).contains("UNIQUE", "user_id", "lower");

        assertThat(constraintDefinition("fk_tag_users"))
                .contains("FOREIGN KEY (user_id)", "users(id)");
        assertThat(constraintDefinition("ck_tag_name_trimmed")).contains("btrim", "name");
    }

    @Test
    void duplicateNameIsBlockedPerOwner() {
        Long ownerId = createUserId();
        insertTag(ownerId, "Horizon");

        assertSqlState("23505", () -> insertTag(ownerId, "horizon"));
        assertSqlState("23505", () -> insertTag(ownerId, "HORIZON"));
    }

    @Test
    void sameNameIsAllowedForDifferentOwners() {
        insertTag(createUserId(), "Horizon");
        insertTag(createUserId(), "horizon");
    }

    @Test
    void rejectsInvalidRawDatabaseRows() {
        Long ownerId = createUserId();

        assertSqlState("23514", () -> insertTag(ownerId, ""));
        assertSqlState("23514", () -> insertTag(ownerId, "   "));
        assertSqlState("23514", () -> insertTag(ownerId, " Horizon"));
        assertSqlState("23514", () -> insertTag(ownerId, "Horizon "));
        assertSqlState("22001", () -> insertTag(ownerId, "x".repeat(101)));
        String supplementaryName = "😀".repeat(101);
        assertThat(supplementaryName.length()).isEqualTo(202);
        assertThat(supplementaryName.codePointCount(0, supplementaryName.length())).isEqualTo(101);
        assertSqlState("22001", () -> insertTag(ownerId, supplementaryName));
        assertSqlState("23503", () -> insertTag(-1L, "Horizon"));
    }

    @Test
    void concurrentCaseVariantsCommitOneTag() throws Exception {
        Long ownerId = createUserId();
        CountDownLatch transactionsReady = new CountDownLatch(2);
        CountDownLatch startInserts = new CountDownLatch(1);
        ExecutorService executor = Executors.newFixedThreadPool(2);
        Throwable testFailure = null;

        try {
            Future<InsertResult> first =
                    executor.submit(
                            () ->
                                    insertInTransaction(
                                            ownerId, "Horizon", transactionsReady, startInserts));
            Future<InsertResult> second =
                    executor.submit(
                            () ->
                                    insertInTransaction(
                                            ownerId, "horizon", transactionsReady, startInserts));

            assertThat(transactionsReady.await(10, TimeUnit.SECONDS)).isTrue();
            startInserts.countDown();
            InsertResult firstResult = first.get(20, TimeUnit.SECONDS);
            InsertResult secondResult = second.get(20, TimeUnit.SECONDS);

            assertThat(List.of(firstResult, secondResult).stream().filter(InsertResult::committed))
                    .hasSize(1);
            assertThat(
                            List.of(firstResult, secondResult).stream()
                                    .filter(result -> !result.committed()))
                    .singleElement()
                    .extracting(InsertResult::sqlState)
                    .isEqualTo("23505");
            assertThat(countTagsByOwnerAndLowerName(ownerId, "horizon")).isEqualTo(1L);
        } catch (Exception | Error failure) {
            testFailure = failure;
            throw failure;
        } finally {
            startInserts.countDown();
            executor.shutdownNow();
            try {
                if (!executor.awaitTermination(10, TimeUnit.SECONDS)) {
                    AssertionError terminationFailure =
                            new AssertionError("Concurrent tag insert workers did not terminate.");
                    if (testFailure == null) {
                        throw terminationFailure;
                    }
                    testFailure.addSuppressed(terminationFailure);
                }
            } catch (InterruptedException exception) {
                Thread.currentThread().interrupt();
                if (testFailure == null) {
                    throw new AssertionError(
                            "Interrupted while waiting for concurrent tag insert workers.",
                            exception);
                }
                testFailure.addSuppressed(exception);
            }
        }
    }

    private InsertResult insertInTransaction(
            Long userId,
            String name,
            CountDownLatch transactionsReady,
            CountDownLatch startInserts) {
        try {
            new TransactionTemplate(transactionManager)
                    .executeWithoutResult(
                            status -> {
                                transactionsReady.countDown();
                                awaitInsertStart(startInserts);
                                insertTag(userId, name);
                            });
            return new InsertResult(true, null);
        } catch (DataAccessException exception) {
            return new InsertResult(false, sqlState(exception));
        }
    }

    private void awaitInsertStart(CountDownLatch startInserts) {
        try {
            if (!startInserts.await(10, TimeUnit.SECONDS)) {
                throw new AssertionError("Concurrent tag insert start signal timed out.");
            }
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            throw new AssertionError("Concurrent tag insert was interrupted.", exception);
        }
    }

    private Long countTagsByOwnerAndLowerName(Long userId, String lowerName) {
        return jdbcTemplate.queryForObject(
                "SELECT count(*) FROM tag WHERE user_id = ? AND lower(name) = ?",
                Long.class,
                userId,
                lowerName);
    }

    private Long createUserId() {
        return jdbcTemplate.queryForObject(
                "INSERT INTO users (email, password_hash, created_at, updated_at) VALUES (?,"
                        + " 'test-hash', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) RETURNING id",
                Long.class,
                UUID.randomUUID() + "@example.com");
    }

    private void insertTag(Long userId, String name) {
        jdbcTemplate.update(
                "INSERT INTO tag (user_id, name, created_at, updated_at) "
                        + "VALUES (?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)",
                userId,
                name);
    }

    private String constraintDefinition(String constraintName) {
        return jdbcTemplate.queryForObject(
                "SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = ?",
                String.class,
                constraintName);
    }

    private void assertSqlState(String expected, Runnable operation) {
        assertThatThrownBy(operation::run)
                .isInstanceOf(DataAccessException.class)
                .satisfies(exception -> assertThat(sqlState(exception)).isEqualTo(expected));
    }

    private String sqlState(Throwable failure) {
        Throwable cause = failure;
        while (cause != null) {
            if (cause instanceof SQLException sqlException) {
                return sqlException.getSQLState();
            }
            cause = cause.getCause();
        }
        return null;
    }

    private record InsertResult(boolean committed, String sqlState) {}
}
