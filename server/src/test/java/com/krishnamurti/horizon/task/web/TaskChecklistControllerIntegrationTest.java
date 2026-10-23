package com.krishnamurti.horizon.task.web;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.jayway.jsonpath.JsonPath;
import com.krishnamurti.horizon.TestcontainersConfiguration;
import com.krishnamurti.horizon.task.infrastructure.TaskRepository;
import com.krishnamurti.horizon.user.application.UserCommandService;
import jakarta.servlet.http.Cookie;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

@SpringBootTest(properties = "spring.jpa.hibernate.ddl-auto=validate")
@AutoConfigureMockMvc
@Import(TestcontainersConfiguration.class)
class TaskChecklistControllerIntegrationTest {

    private static final String PASSWORD = "Password123!";

    @Autowired private MockMvc mockMvc;
    @Autowired private UserCommandService userCommandService;
    @Autowired private JdbcTemplate jdbcTemplate;
    @Autowired private TaskRepository taskRepository;
    @Autowired private PlatformTransactionManager transactionManager;

    private String ownerEmail;
    private Cookie ownerCookie;

    @BeforeEach
    void setUpUserAndSession() throws Exception {
        ownerEmail = UUID.randomUUID() + "@example.com";
        userCommandService.register(ownerEmail, PASSWORD);
        ownerCookie = login(ownerEmail);
    }

    @Test
    void addItemReturns201AndStablePosition() throws Exception {
        createTask("Checklist add");
        Long taskId = taskIdForTitle("Checklist add");

        mockMvc.perform(addItem(taskId, "  First item  "))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.title").value("First item"))
                .andExpect(jsonPath("$.position").value(0));
        mockMvc.perform(addItem(taskId, "Second item"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.title").value("Second item"))
                .andExpect(jsonPath("$.position").value(1));
    }

    @Test
    void renameAndClearDueDateRoundTrip() throws Exception {
        createTask("Checklist patch");
        Long taskId = taskIdForTitle("Checklist patch");
        Long itemId = addItemAndGetId(taskId, "Before");

        mockMvc.perform(patchItem(taskId, itemId, "{\"title\":\"  After  \"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.title").value("After"));
        mockMvc.perform(patchItem(taskId, itemId, "{\"dueDate\":\"2026-11-02\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.dueDate").value("2026-11-02"));
        mockMvc.perform(patchItem(taskId, itemId, "{\"dueDate\":null}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.dueDate").doesNotExist());
    }

    @Test
    void completeAndReopenAreIdempotentAndDoNotCompleteParent() throws Exception {
        createTask("Checklist completion");
        Long taskId = taskIdForTitle("Checklist completion");
        Long itemId = addItemAndGetId(taskId, "Independent item");

        mockMvc.perform(post(itemPath(taskId, itemId) + "/complete").cookie(ownerCookie))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.completedAt").isNotEmpty());
        OffsetDateTime firstCompletion =
                jdbcTemplate.queryForObject(
                        "SELECT completed_at FROM checklist_item WHERE id = ?",
                        OffsetDateTime.class,
                        itemId);
        mockMvc.perform(post(itemPath(taskId, itemId) + "/complete").cookie(ownerCookie))
                .andExpect(status().isOk());
        assertThat(
                        jdbcTemplate.queryForObject(
                                "SELECT completed_at FROM checklist_item WHERE id = ?",
                                OffsetDateTime.class,
                                itemId))
                .isEqualTo(firstCompletion);

        mockMvc.perform(post(itemPath(taskId, itemId) + "/reopen").cookie(ownerCookie))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.completedAt").doesNotExist());
        mockMvc.perform(post(itemPath(taskId, itemId) + "/reopen").cookie(ownerCookie))
                .andExpect(status().isOk());
        assertThat(
                        jdbcTemplate.queryForObject(
                                "SELECT completed_at FROM task WHERE id = ?",
                                OffsetDateTime.class,
                                taskId))
                .isNull();
    }

    @Test
    void invalidTitleDateAndUnknownPatchFieldReturn400ProblemDetails() throws Exception {
        createTask("Checklist validation");
        Long taskId = taskIdForTitle("Checklist validation");
        Long itemId = addItemAndGetId(taskId, "Valid");

        mockMvc.perform(addItem(taskId, "  ")).andExpect(status().isBadRequest());
        mockMvc.perform(patchItem(taskId, itemId, "{\"dueDate\":\"not-a-date\"}"))
                .andExpect(status().isBadRequest());
        mockMvc.perform(patchItem(taskId, itemId, "{\"unexpected\":true}"))
                .andExpect(status().isBadRequest());
    }

    @Test
    void nonOwnerOrForeignTaskItemReturns404() throws Exception {
        createTask("Checklist owner first task");
        createTask("Checklist owner second task");
        Long firstTaskId = taskIdForTitle("Checklist owner first task");
        Long secondTaskId = taskIdForTitle("Checklist owner second task");
        Long itemId = addItemAndGetId(firstTaskId, "Private item");

        mockMvc.perform(patchItem(secondTaskId, itemId, "{\"title\":\"Leaked\"}"))
                .andExpect(status().isNotFound());

        String otherEmail = UUID.randomUUID() + "@example.com";
        userCommandService.register(otherEmail, PASSWORD);
        Cookie otherCookie = login(otherEmail);
        mockMvc.perform(
                        patch(itemPath(firstTaskId, itemId))
                                .cookie(otherCookie)
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"title\":\"Leaked\"}"))
                .andExpect(status().isNotFound());
    }

    @Test
    void archivedParentEditableDeletedParentUnavailable() throws Exception {
        createTask("Checklist archived parent");
        Long taskId = taskIdForTitle("Checklist archived parent");
        Long itemId = addItemAndGetId(taskId, "Editable");
        jdbcTemplate.update(
                "UPDATE task SET archived_at = ? WHERE id = ?",
                OffsetDateTime.now(ZoneOffset.UTC),
                taskId);

        mockMvc.perform(patchItem(taskId, itemId, "{\"title\":\"Still editable\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.title").value("Still editable"));
        jdbcTemplate.update(
                "UPDATE task SET deleted_at = ? WHERE id = ?",
                OffsetDateTime.now(ZoneOffset.UTC),
                taskId);
        mockMvc.perform(patchItem(taskId, itemId, "{\"title\":\"Unavailable\"}"))
                .andExpect(status().isNotFound());
    }

    @Test
    void reorderPersistsExactIdsAcrossReload() throws Exception {
        createTask("Checklist reorder");
        Long taskId = taskIdForTitle("Checklist reorder");
        Long first = addItemAndGetId(taskId, "First");
        Long second = addItemAndGetId(taskId, "Second");
        Long third = addItemAndGetId(taskId, "Third");

        mockMvc.perform(reorder(taskId, List.of(third, first, second)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].id").value(third))
                .andExpect(jsonPath("$[0].position").value(0))
                .andExpect(jsonPath("$[1].id").value(first))
                .andExpect(jsonPath("$[2].id").value(second));
        assertThat(activeIds(taskId)).containsExactly(third, first, second);
    }

    @Test
    void reorderRejectsStaleMissingAndDuplicateIdsWithoutPartialWrites() throws Exception {
        createTask("Checklist stale reorder");
        Long taskId = taskIdForTitle("Checklist stale reorder");
        Long first = addItemAndGetId(taskId, "First");
        addItemAndGetId(taskId, "Second");
        List<Long> before = activeIds(taskId);

        mockMvc.perform(reorder(taskId, List.of(first, first))).andExpect(status().isConflict());
        mockMvc.perform(reorder(taskId, List.of(first))).andExpect(status().isConflict());
        assertThat(activeIds(taskId)).containsExactlyElementsOf(before);
    }

    @Test
    void foreignChildInReorderReturns404() throws Exception {
        createTask("Checklist reorder first parent");
        createTask("Checklist reorder second parent");
        Long firstTask = taskIdForTitle("Checklist reorder first parent");
        Long secondTask = taskIdForTitle("Checklist reorder second parent");
        Long itemId = addItemAndGetId(firstTask, "First parent item");

        mockMvc.perform(reorder(secondTask, List.of(itemId))).andExpect(status().isNotFound());
    }

    @Test
    void removeHidesItemAndRenumbers() throws Exception {
        createTask("Checklist remove");
        Long taskId = taskIdForTitle("Checklist remove");
        Long first = addItemAndGetId(taskId, "First");
        Long second = addItemAndGetId(taskId, "Second");
        Long third = addItemAndGetId(taskId, "Third");

        mockMvc.perform(delete(itemPath(taskId, second)).cookie(ownerCookie))
                .andExpect(status().isNoContent());

        assertThat(activeIds(taskId)).containsExactly(first, third);
        assertThat(positionFor(third)).isEqualTo(1);
        assertThat(
                        jdbcTemplate.queryForObject(
                                "SELECT deleted_at IS NOT NULL FROM checklist_item WHERE id = ?",
                                Boolean.class,
                                second))
                .isTrue();
    }

    @Test
    void restorePreservesIdentityDateCompletionAndPreviousPosition() throws Exception {
        createTask("Checklist restore");
        Long taskId = taskIdForTitle("Checklist restore");
        Long first = addItemAndGetId(taskId, "First");
        Long restored = addItemAndGetId(taskId, "Restored");
        Long last = addItemAndGetId(taskId, "Last");
        mockMvc.perform(patchItem(taskId, restored, "{\"dueDate\":\"2026-11-02\"}"))
                .andExpect(status().isOk());
        mockMvc.perform(post(itemPath(taskId, restored) + "/complete").cookie(ownerCookie))
                .andExpect(status().isOk());
        mockMvc.perform(delete(itemPath(taskId, restored)).cookie(ownerCookie))
                .andExpect(status().isNoContent());

        mockMvc.perform(post(itemPath(taskId, restored) + "/restore").cookie(ownerCookie))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value(restored))
                .andExpect(jsonPath("$.dueDate").value("2026-11-02"))
                .andExpect(jsonPath("$.completedAt").isNotEmpty())
                .andExpect(jsonPath("$.position").value(1));
        assertThat(activeIds(taskId)).containsExactly(first, restored, last);
        assertThat(
                        jdbcTemplate.queryForObject(
                                "SELECT COUNT(*) FROM checklist_item WHERE id = ?",
                                Long.class,
                                restored))
                .isEqualTo(1L);
    }

    @Test
    void repeatedRestoreDoesNotDuplicate() throws Exception {
        createTask("Checklist repeated restore");
        Long taskId = taskIdForTitle("Checklist repeated restore");
        Long itemId = addItemAndGetId(taskId, "One item");
        mockMvc.perform(delete(itemPath(taskId, itemId)).cookie(ownerCookie))
                .andExpect(status().isNoContent());

        mockMvc.perform(post(itemPath(taskId, itemId) + "/restore").cookie(ownerCookie))
                .andExpect(status().isOk());
        mockMvc.perform(post(itemPath(taskId, itemId) + "/restore").cookie(ownerCookie))
                .andExpect(status().isOk());
        assertThat(activeIds(taskId)).containsExactly(itemId);
    }

    @Test
    void removeThenAddThenRestoreClampsPosition() throws Exception {
        createTask("Checklist clamp restore");
        Long taskId = taskIdForTitle("Checklist clamp restore");
        Long first = addItemAndGetId(taskId, "First");
        Long middle = addItemAndGetId(taskId, "Middle");
        Long last = addItemAndGetId(taskId, "Last");
        mockMvc.perform(delete(itemPath(taskId, last)).cookie(ownerCookie))
                .andExpect(status().isNoContent());
        mockMvc.perform(delete(itemPath(taskId, middle)).cookie(ownerCookie))
                .andExpect(status().isNoContent());

        mockMvc.perform(post(itemPath(taskId, last) + "/restore").cookie(ownerCookie))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.position").value(1));
        assertThat(activeIds(taskId)).containsExactly(first, last);
    }

    @Test
    void structuralWritersSerializeOnTheParentLock() throws Exception {
        createTask("Checklist structural lock");
        Long taskId = taskIdForTitle("Checklist structural lock");
        Long userId =
                jdbcTemplate.queryForObject(
                        "SELECT user_id FROM task WHERE id = ?", Long.class, taskId);
        CountDownLatch firstLocked = new CountDownLatch(1);
        CountDownLatch releaseFirst = new CountDownLatch(1);
        CountDownLatch secondAttempting = new CountDownLatch(1);
        CountDownLatch secondLocked = new CountDownLatch(1);
        ExecutorService executor = Executors.newFixedThreadPool(2);
        try {
            Future<?> first =
                    executor.submit(
                            () ->
                                    new TransactionTemplate(transactionManager)
                                            .executeWithoutResult(
                                                    status -> {
                                                        var lockedTask =
                                                                taskRepository
                                                                        .lockOwnedForChecklistWrite(
                                                                                taskId, userId)
                                                                        .orElseThrow();
                                                        assertThat(lockedTask.getId())
                                                                .isEqualTo(taskId);
                                                        firstLocked.countDown();
                                                        await(releaseFirst);
                                                    }));
            assertThat(firstLocked.await(5, TimeUnit.SECONDS)).isTrue();
            Future<?> second =
                    executor.submit(
                            () ->
                                    new TransactionTemplate(transactionManager)
                                            .executeWithoutResult(
                                                    status -> {
                                                        secondAttempting.countDown();
                                                        var lockedTask =
                                                                taskRepository
                                                                        .lockOwnedForChecklistWrite(
                                                                                taskId, userId)
                                                                        .orElseThrow();
                                                        assertThat(lockedTask.getId())
                                                                .isEqualTo(taskId);
                                                        secondLocked.countDown();
                                                    }));
            assertThat(secondAttempting.await(5, TimeUnit.SECONDS)).isTrue();
            assertThat(secondLocked.await(150, TimeUnit.MILLISECONDS)).isFalse();
            releaseFirst.countDown();
            assertThat(secondLocked.await(5, TimeUnit.SECONDS)).isTrue();
            first.get(5, TimeUnit.SECONDS);
            second.get(5, TimeUnit.SECONDS);
        } finally {
            releaseFirst.countDown();
            executor.shutdownNow();
        }
    }

    private org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder addItem(
            Long taskId, String title) {
        return post("/api/v1/tasks/{taskId}/checklist-items", taskId)
                .cookie(ownerCookie)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"title\":\"" + title + "\"}");
    }

    private org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder patchItem(
            Long taskId, Long itemId, String body) {
        return patch(itemPath(taskId, itemId))
                .cookie(ownerCookie)
                .contentType(MediaType.APPLICATION_JSON)
                .content(body);
    }

    private String itemPath(Long taskId, Long itemId) {
        return "/api/v1/tasks/" + taskId + "/checklist-items/" + itemId;
    }

    private Long addItemAndGetId(Long taskId, String title) throws Exception {
        MvcResult result =
                mockMvc.perform(addItem(taskId, title)).andExpect(status().isCreated()).andReturn();
        return JsonPath.parse(result.getResponse().getContentAsString()).read("$.id", Long.class);
    }

    private org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder reorder(
            Long taskId, List<Long> itemIds) {
        String ids =
                itemIds.stream()
                        .map(String::valueOf)
                        .collect(java.util.stream.Collectors.joining(","));
        return put("/api/v1/tasks/{taskId}/checklist-items/order", taskId)
                .cookie(ownerCookie)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"itemIds\":[" + ids + "]}");
    }

    private List<Long> activeIds(Long taskId) {
        return jdbcTemplate.queryForList(
                "SELECT id FROM checklist_item WHERE task_id = ? AND deleted_at IS NULL ORDER BY"
                        + " position, id",
                Long.class,
                taskId);
    }

    private int positionFor(Long itemId) {
        return jdbcTemplate.queryForObject(
                "SELECT position FROM checklist_item WHERE id = ?", Integer.class, itemId);
    }

    private void await(CountDownLatch latch) {
        try {
            if (!latch.await(10, TimeUnit.SECONDS)) {
                throw new AssertionError("Timed out waiting for concurrent transaction");
            }
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            throw new AssertionError(
                    "Interrupted while waiting for concurrent transaction", exception);
        }
    }

    private void createTask(String title) throws Exception {
        mockMvc.perform(
                        post("/api/v1/tasks")
                                .cookie(ownerCookie)
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"title\":\"" + title + "\"}"))
                .andExpect(status().isCreated());
    }

    private Long taskIdForTitle(String title) {
        return jdbcTemplate.queryForObject(
                "SELECT id FROM task WHERE title = ?", Long.class, title);
    }

    private Cookie login(String email) throws Exception {
        MvcResult result =
                mockMvc.perform(
                                post("/api/v1/auth/login")
                                        .contentType(MediaType.APPLICATION_JSON)
                                        .content(
                                                "{\"email\":\""
                                                        + email
                                                        + "\",\"password\":\""
                                                        + PASSWORD
                                                        + "\"}"))
                        .andExpect(status().isOk())
                        .andReturn();
        Cookie cookie = result.getResponse().getCookie("SESSION");
        assertThat(cookie).isNotNull();
        return cookie;
    }
}
