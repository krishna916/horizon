package com.krishnamurti.horizon.note.web;

import static org.assertj.core.api.Assertions.assertThat;

import com.krishnamurti.horizon.TestcontainersConfiguration;
import com.krishnamurti.horizon.note.application.IdempotentNoteCreationService;
import com.krishnamurti.horizon.user.application.UserCommandService;
import java.util.ArrayList;
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
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;

@SpringBootTest
@Import(TestcontainersConfiguration.class)
class NoteCreationConcurrencyIntegrationTest {

    @Autowired private IdempotentNoteCreationService creationService;
    @Autowired private UserCommandService userCommandService;
    @Autowired private JdbcTemplate jdbcTemplate;

    @Test
    void concurrentSameKeyRequestsCreateExactlyOneNote() throws Exception {
        Long userId = createUserId();
        UUID key = UUID.randomUUID();
        Map<String, Object> content = body("concurrent content");
        int requestCount = 12;
        CountDownLatch ready = new CountDownLatch(requestCount);
        CountDownLatch start = new CountDownLatch(1);
        ExecutorService executor = Executors.newFixedThreadPool(requestCount);
        try {
            List<Callable<Long>> requests = new ArrayList<>();
            for (int index = 0; index < requestCount; index++) {
                requests.add(
                        () -> {
                            SecurityContextHolder.getContext()
                                    .setAuthentication(
                                            new UsernamePasswordAuthenticationToken(
                                                    userId, "", List.of()));
                            ready.countDown();
                            if (!start.await(10, TimeUnit.SECONDS)) {
                                throw new IllegalStateException(
                                        "Concurrent request start timed out");
                            }
                            try {
                                return creationService.create(key, "Title", content).getId();
                            } finally {
                                SecurityContextHolder.clearContext();
                            }
                        });
            }
            List<Future<Long>> results = requests.stream().map(executor::submit).toList();
            assertThat(ready.await(10, TimeUnit.SECONDS)).isTrue();
            start.countDown();

            List<Long> noteIds = results.stream().map(this::getResult).toList();
            assertThat(noteIds).allMatch(noteIds.getFirst()::equals);
            assertThat(
                            jdbcTemplate.queryForObject(
                                    "SELECT count(*) FROM note WHERE user_id = ?",
                                    Long.class,
                                    userId))
                    .isEqualTo(1L);
            assertThat(
                            jdbcTemplate.queryForObject(
                                    "SELECT count(*) FROM note_creation_request WHERE user_id = ?"
                                            + " AND request_key = ?",
                                    Long.class,
                                    userId,
                                    key))
                    .isEqualTo(1L);
        } finally {
            start.countDown();
            executor.shutdownNow();
            assertThat(executor.awaitTermination(10, TimeUnit.SECONDS)).isTrue();
        }
    }

    private Long createUserId() {
        String suffix = UUID.randomUUID().toString();
        return userCommandService
                .register("note-concurrent-" + suffix + "@example.com", "StrongPassword123!")
                .id();
    }

    private Long getResult(Future<Long> future) {
        try {
            return future.get(20, TimeUnit.SECONDS);
        } catch (Exception exception) {
            throw new AssertionError(exception);
        }
    }

    private static Map<String, Object> body(String text) {
        return Map.of(
                "type",
                "doc",
                "content",
                List.of(
                        Map.of(
                                "type",
                                "paragraph",
                                "content",
                                List.of(Map.of("type", "text", "text", text)))));
    }
}
