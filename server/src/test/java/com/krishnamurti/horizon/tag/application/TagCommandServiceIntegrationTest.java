package com.krishnamurti.horizon.tag.application;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.krishnamurti.horizon.HorizonApplication;
import com.krishnamurti.horizon.TestcontainersConfiguration;
import com.krishnamurti.horizon.tag.api.InvalidTagNameException;
import com.krishnamurti.horizon.tag.api.TagCommandApi;
import com.krishnamurti.horizon.tag.api.TagQueryApi;
import com.krishnamurti.horizon.tag.api.TagReference;
import java.time.OffsetDateTime;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.IllegalTransactionStateException;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

@SpringBootTest(
        classes = HorizonApplication.class,
        properties = "spring.jpa.hibernate.ddl-auto=validate")
@Import(TestcontainersConfiguration.class)
class TagCommandServiceIntegrationTest {

    @Autowired private TagCommandService tagCommandService;
    @Autowired private TagCommandApi tagCommandApi;
    @Autowired private TagQueryApi tagQueryApi;
    @Autowired private JdbcTemplate jdbcTemplate;
    @Autowired private PlatformTransactionManager transactionManager;

    @Test
    void insertsAndReturnsFreshTag() {
        Long userId = createUserId();

        TagReference tag =
                inReadCommittedTransaction(
                        () -> tagCommandService.resolveByName(userId, "Horizon"));

        assertThat(tag.id()).isNotNull();
        assertThat(tag.name()).isEqualTo("Horizon");
        assertThat(countTags(userId, "horizon")).isEqualTo(1);
    }

    @Test
    void resolvedTagIsSuggestedAfterCommitOnlyToItsOwner() {
        Long ownerId = createUserId();
        Long otherOwnerId = createUserId();

        TagReference resolved =
                inReadCommittedTransaction(
                        () -> tagCommandApi.resolveByName(ownerId, "Workflow Tag"));

        assertThat(tagQueryApi.suggest(ownerId, "work"))
                .containsExactly(new TagReference(resolved.id(), "Workflow Tag"));
        assertThat(tagQueryApi.suggest(otherOwnerId, "work")).isEmpty();
    }

    @Test
    void reusesCaseInsensitiveNameAndPreservesFirstDisplaySpelling() {
        Long userId = createUserId();

        TagReference first =
                inReadCommittedTransaction(
                        () -> tagCommandService.resolveByName(userId, "Horizon"));
        TagReference second =
                inReadCommittedTransaction(
                        () -> tagCommandService.resolveByName(userId, "horizon"));

        assertThat(second).isEqualTo(first);
        assertThat(countTags(userId, "horizon")).isEqualTo(1);
    }

    @Test
    void permitsSameNameForDifferentOwners() {
        Long firstOwner = createUserId();
        Long secondOwner = createUserId();

        TagReference first =
                inReadCommittedTransaction(
                        () -> tagCommandService.resolveByName(firstOwner, "Horizon"));
        TagReference second =
                inReadCommittedTransaction(
                        () -> tagCommandService.resolveByName(secondOwner, "Horizon"));

        assertThat(second.id()).isNotEqualTo(first.id());
    }

    @Test
    void translatesInvalidNamesAtPublicApiBoundary() {
        Long userId = createUserId();

        assertThatThrownBy(
                        () ->
                                inReadCommittedTransaction(
                                        () -> tagCommandService.resolveByName(userId, "  ")))
                .isInstanceOfSatisfying(
                        InvalidTagNameException.class,
                        exception -> assertThat(exception.getField()).isEqualTo("name"));
    }

    @Test
    void requiresCallerTransaction() {
        assertThatThrownBy(() -> tagCommandService.resolveByName(createUserId(), "Horizon"))
                .isInstanceOf(IllegalTransactionStateException.class);
    }

    @Test
    void rollsBackNewTagWithFailedCallingUseCase() {
        Long userId = createUserId();

        assertThatThrownBy(
                        () ->
                                newReadCommittedTemplate()
                                        .execute(
                                                status -> {
                                                    tagCommandService.resolveByName(
                                                            userId, "Rollback");
                                                    throw new IllegalStateException(
                                                            "assignment failed");
                                                }))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("assignment failed");

        assertThat(countTags(userId, "rollback")).isZero();
    }

    @Test
    void reuseDoesNotChangePersistenceTimestamps() {
        Long userId = createUserId();
        TagReference tag =
                inReadCommittedTransaction(
                        () -> tagCommandService.resolveByName(userId, "Horizon"));
        TagTimestamps before = timestamps(tag.id());

        inReadCommittedTransaction(() -> tagCommandService.resolveByName(userId, "horizon"));

        assertThat(timestamps(tag.id())).isEqualTo(before);
    }

    @Test
    void concurrentCaseVariantsResolveToOneIdentity() throws Exception {
        Long userId = createUserId();
        CountDownLatch firstResolved = new CountDownLatch(1);
        CountDownLatch releaseFirst = new CountDownLatch(1);
        CountDownLatch secondStarted = new CountDownLatch(1);
        AtomicInteger secondBackendPid = new AtomicInteger();
        ExecutorService executor = Executors.newFixedThreadPool(2);

        try {
            Future<TagReference> first =
                    executor.submit(
                            () ->
                                    newReadCommittedTemplate()
                                            .execute(
                                                    status -> {
                                                        TagReference result =
                                                                tagCommandService.resolveByName(
                                                                        userId, "Horizon");
                                                        firstResolved.countDown();
                                                        await(releaseFirst);
                                                        return result;
                                                    }));

            assertThat(firstResolved.await(10, TimeUnit.SECONDS)).isTrue();

            Future<TagReference> second =
                    executor.submit(
                            () ->
                                    inReadCommittedTransaction(
                                            () -> {
                                                secondBackendPid.set(
                                                        jdbcTemplate.queryForObject(
                                                                "SELECT pg_backend_pid()",
                                                                Integer.class));
                                                secondStarted.countDown();
                                                return tagCommandService.resolveByName(
                                                        userId, "horizon");
                                            }));
            assertThat(secondStarted.await(10, TimeUnit.SECONDS)).isTrue();
            assertThat(awaitSecondInsertWait(secondBackendPid.get())).isTrue();
            releaseFirst.countDown();

            TagReference firstResult = first.get(10, TimeUnit.SECONDS);
            TagReference secondResult = second.get(10, TimeUnit.SECONDS);
            assertThat(secondResult).isEqualTo(firstResult);
            assertThat(firstResult.name()).isEqualTo("Horizon");
            assertThat(countTags(userId, "horizon")).isEqualTo(1);
            assertThat(
                            inReadCommittedTransaction(
                                    () -> tagCommandService.resolveByName(userId, "HORIZON")))
                    .isEqualTo(firstResult);
        } finally {
            releaseFirst.countDown();
            executor.shutdownNow();
        }
    }

    private TagReference inReadCommittedTransaction(
            java.util.function.Supplier<TagReference> work) {
        return newReadCommittedTemplate().execute(status -> work.get());
    }

    private TransactionTemplate newReadCommittedTemplate() {
        TransactionTemplate template = new TransactionTemplate(transactionManager);
        template.setIsolationLevel(TransactionDefinition.ISOLATION_READ_COMMITTED);
        return template;
    }

    private void await(CountDownLatch latch) {
        try {
            if (!latch.await(10, TimeUnit.SECONDS)) {
                throw new AssertionError("Timed out waiting for concurrent Tag resolution.");
            }
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            throw new AssertionError("Concurrent Tag resolution was interrupted.", exception);
        }
    }

    private boolean awaitSecondInsertWait(int backendPid) {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5);
        while (System.nanoTime() < deadline) {
            Boolean waiting =
                    jdbcTemplate.queryForObject(
                            "SELECT EXISTS (SELECT 1 FROM pg_stat_activity "
                                    + "WHERE pid = ? AND wait_event_type = 'Lock' "
                                    + "AND lower(query) LIKE 'insert into tag%')",
                            Boolean.class, backendPid);
            if (Boolean.TRUE.equals(waiting)) {
                return true;
            }
            try {
                Thread.sleep(10);
            } catch (InterruptedException exception) {
                Thread.currentThread().interrupt();
                throw new AssertionError("Concurrent Tag resolution was interrupted.", exception);
            }
        }
        return false;
    }

    private Long createUserId() {
        return jdbcTemplate.queryForObject(
                "INSERT INTO users (email, password_hash, created_at, updated_at) VALUES (?,"
                        + " 'test-hash', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) RETURNING id",
                Long.class,
                UUID.randomUUID() + "@example.com");
    }

    private Long countTags(Long userId, String lowerName) {
        return jdbcTemplate.queryForObject(
                "SELECT count(*) FROM tag WHERE user_id = ? AND lower(name) = ?",
                Long.class,
                userId,
                lowerName);
    }

    private TagTimestamps timestamps(Long tagId) {
        return jdbcTemplate.queryForObject(
                "SELECT created_at, updated_at FROM tag WHERE id = ?",
                (resultSet, rowNum) ->
                        new TagTimestamps(
                                resultSet.getObject("created_at", OffsetDateTime.class),
                                resultSet.getObject("updated_at", OffsetDateTime.class)),
                tagId);
    }

    private record TagTimestamps(OffsetDateTime createdAt, OffsetDateTime updatedAt) {}
}
