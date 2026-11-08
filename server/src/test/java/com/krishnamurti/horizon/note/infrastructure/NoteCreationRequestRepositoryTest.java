package com.krishnamurti.horizon.note.infrastructure;

import static org.assertj.core.api.Assertions.assertThat;

import com.krishnamurti.horizon.TestcontainersConfiguration;
import com.krishnamurti.horizon.note.domain.Note;
import com.krishnamurti.horizon.user.application.UserCommandService;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.Callable;
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

@SpringBootTest
@Import(TestcontainersConfiguration.class)
class NoteCreationRequestRepositoryTest {

    @Autowired private NoteCreationRequestRepository requests;
    @Autowired private NoteRepository notes;
    @Autowired private UserCommandService userCommandService;
    @Autowired private JdbcTemplate jdbcTemplate;
    @Autowired private PlatformTransactionManager transactionManager;

    @Test
    void claimCompleteAndFindAreOwnerScoped() {
        Long firstOwner = createUserId();
        Long secondOwner = createUserId();
        UUID key = UUID.randomUUID();
        Long noteId = notes.saveAndFlush(Note.create(firstOwner, "title", null)).getId();
        String fingerprint = "a".repeat(64);

        new TransactionTemplate(transactionManager)
                .executeWithoutResult(
                        ignored -> {
                            assertThat(requests.claim(firstOwner, key, fingerprint)).isTrue();
                            requests.complete(firstOwner, key, noteId);
                        });
        assertThat(requests.find(firstOwner, key))
                .contains(new NoteCreationReceipt(fingerprint, noteId));
        assertThat(claimInTransaction(firstOwner, key, fingerprint)).isFalse();
        assertThat(claimInTransaction(secondOwner, key, "b".repeat(64))).isTrue();
    }

    @Test
    void rolledBackClaimCanBeRetried() {
        Long userId = createUserId();
        UUID key = UUID.randomUUID();
        TransactionTemplate transaction = new TransactionTemplate(transactionManager);
        transaction.executeWithoutResult(
                status -> {
                    assertThat(requests.claim(userId, key, "c".repeat(64))).isTrue();
                    status.setRollbackOnly();
                });

        assertThat(claimInTransaction(userId, key, "c".repeat(64))).isTrue();
    }

    @Test
    void concurrentClaimsCreateOneOwnerKeyReceipt() throws Exception {
        Long userId = createUserId();
        UUID key = UUID.randomUUID();
        ExecutorService executor = Executors.newFixedThreadPool(8);
        try {
            List<Callable<Boolean>> claims = new ArrayList<>();
            for (int index = 0; index < 16; index++) {
                claims.add(
                        () ->
                                new TransactionTemplate(transactionManager)
                                        .execute(
                                                status ->
                                                        requests.claim(
                                                                userId, key, "d".repeat(64))));
            }
            List<Future<Boolean>> results = executor.invokeAll(claims);
            assertThat(results.stream().filter(this::getResult).count()).isEqualTo(1);
            assertThat(
                            jdbcTemplate.queryForObject(
                                    "SELECT count(*) FROM note_creation_request WHERE user_id = ?"
                                            + " AND request_key = ?",
                                    Long.class,
                                    userId,
                                    key))
                    .isEqualTo(1L);
        } finally {
            executor.shutdownNow();
            assertThat(executor.awaitTermination(5, TimeUnit.SECONDS)).isTrue();
        }
    }

    private Long createUserId() {
        String suffix = UUID.randomUUID().toString();
        return userCommandService
                .register("note-request-" + suffix + "@example.com", "StrongPassword123!")
                .id();
    }

    private Boolean claimInTransaction(Long userId, UUID key, String fingerprint) {
        return new TransactionTemplate(transactionManager)
                .execute(status -> Boolean.valueOf(requests.claim(userId, key, fingerprint)));
    }

    private boolean getResult(Future<Boolean> future) {
        try {
            return future.get(10, TimeUnit.SECONDS);
        } catch (Exception exception) {
            throw new AssertionError(exception);
        }
    }
}
