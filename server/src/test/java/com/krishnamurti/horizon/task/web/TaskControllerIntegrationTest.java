package com.krishnamurti.horizon.task.web;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.not;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.jayway.jsonpath.JsonPath;
import com.krishnamurti.horizon.TestcontainersConfiguration;
import com.krishnamurti.horizon.user.application.UserCommandService;
import jakarta.servlet.http.Cookie;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.UUID;
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

@SpringBootTest(properties = "spring.jpa.hibernate.ddl-auto=validate")
@AutoConfigureMockMvc
@Import(TestcontainersConfiguration.class)
class TaskControllerIntegrationTest {

    private static final String PASSWORD = "Password123!";

    @Autowired private MockMvc mockMvc;
    @Autowired private UserCommandService userCommandService;
    @Autowired private JdbcTemplate jdbcTemplate;

    private String ownerEmail;
    private Cookie ownerCookie;

    @BeforeEach
    void setUpUserAndSession() throws Exception {
        ownerEmail = UUID.randomUUID() + "@example.com";
        userCommandService.register(ownerEmail, PASSWORD);
        ownerCookie = login(ownerEmail);
    }

    @Test
    void unauthenticatedCallsReturn401() throws Exception {
        mockMvc.perform(get("/api/v1/tasks")).andExpect(status().isUnauthorized());
        mockMvc.perform(post("/api/v1/tasks").contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void archiveAndRestoreUnfinishedTask() throws Exception {
        createTask("Archive unfinished", "{\"title\":\"Archive unfinished\"}");
        Long id = taskIdForTitle("Archive unfinished");

        mockMvc.perform(post("/api/v1/tasks/{id}/archive", id).cookie(ownerCookie))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.archivedAt").isNotEmpty())
                .andExpect(jsonPath("$.completedAt").value(org.hamcrest.Matchers.nullValue()));
        assertThat(
                        jdbcTemplate.queryForObject(
                                "SELECT archived_at FROM task WHERE id = ?",
                                OffsetDateTime.class,
                                id))
                .isNotNull();

        mockMvc.perform(post("/api/v1/tasks/{id}/restore", id).cookie(ownerCookie))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.archivedAt").value(org.hamcrest.Matchers.nullValue()));
        assertThat(
                        jdbcTemplate.queryForObject(
                                "SELECT archived_at FROM task WHERE id = ?",
                                OffsetDateTime.class,
                                id))
                .isNull();
    }

    @Test
    void restoreArchivedCompletedTaskRetainsCompletion() throws Exception {
        createTask("Restore completed archive", "{\"title\":\"Restore completed archive\"}");
        Long id = taskIdForTitle("Restore completed archive");
        OffsetDateTime completedAt = OffsetDateTime.parse("2026-10-20T12:00:00Z");
        jdbcTemplate.update("UPDATE task SET completed_at = ? WHERE id = ?", completedAt, id);

        mockMvc.perform(post("/api/v1/tasks/{id}/archive", id).cookie(ownerCookie))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.completedAt").value(org.hamcrest.Matchers.notNullValue()));
        mockMvc.perform(post("/api/v1/tasks/{id}/restore", id).cookie(ownerCookie))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.archivedAt").value(org.hamcrest.Matchers.nullValue()))
                .andExpect(jsonPath("$.completedAt").value(org.hamcrest.Matchers.notNullValue()));
        assertThat(
                        jdbcTemplate.queryForObject(
                                "SELECT completed_at FROM task WHERE id = ?",
                                OffsetDateTime.class,
                                id))
                .isEqualTo(completedAt);
    }

    @Test
    void softDeleteHidesFromOrdinaryGetListAndUpdates() throws Exception {
        createTask("Soft delete target", "{\"title\":\"Soft delete target\"}");
        Long id = taskIdForTitle("Soft delete target");

        mockMvc.perform(
                        org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete(
                                        "/api/v1/tasks/{id}", id)
                                .cookie(ownerCookie))
                .andExpect(status().isNoContent());
        assertThat(
                        jdbcTemplate.queryForObject(
                                "SELECT deleted_at FROM task WHERE id = ?",
                                OffsetDateTime.class,
                                id))
                .isNotNull();
        mockMvc.perform(get("/api/v1/tasks/{id}", id).cookie(ownerCookie))
                .andExpect(status().isNotFound());
        mockMvc.perform(get("/api/v1/tasks").cookie(ownerCookie))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[?(@.id == " + id + ")]").doesNotExist());
        mockMvc.perform(
                        patch("/api/v1/tasks/{id}", id)
                                .cookie(ownerCookie)
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"title\":\"Must stay hidden\"}"))
                .andExpect(status().isNotFound());
        mockMvc.perform(post("/api/v1/tasks/{id}/complete", id).cookie(ownerCookie))
                .andExpect(status().isNotFound());
    }

    @Test
    void undoDeleteRestoresArchivedCompletedChecklist() throws Exception {
        createTask(
                "Undo deleted facts",
                "{\"title\":\"Undo deleted facts\",\"checklist\":[{\"title\":\"Keep this"
                        + " item\"}]}");
        Long id = taskIdForTitle("Undo deleted facts");
        OffsetDateTime completedAt = OffsetDateTime.parse("2026-10-20T12:00:00Z");
        OffsetDateTime archivedAt = OffsetDateTime.parse("2026-10-21T12:00:00Z");
        jdbcTemplate.update(
                "UPDATE task SET completed_at = ?, archived_at = ? WHERE id = ?",
                completedAt,
                archivedAt,
                id);
        assertThat(checklistItemCount(id)).isEqualTo(1);

        mockMvc.perform(
                        org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete(
                                        "/api/v1/tasks/{id}", id)
                                .cookie(ownerCookie))
                .andExpect(status().isNoContent());
        mockMvc.perform(post("/api/v1/tasks/{id}/restore-deleted", id).cookie(ownerCookie))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.archivedAt").isNotEmpty())
                .andExpect(jsonPath("$.completedAt").isNotEmpty())
                .andExpect(jsonPath("$.checklist.length()").value(1));

        assertThat(
                        jdbcTemplate.queryForObject(
                                "SELECT deleted_at FROM task WHERE id = ?",
                                OffsetDateTime.class,
                                id))
                .isNull();
        assertThat(
                        jdbcTemplate.queryForObject(
                                "SELECT archived_at FROM task WHERE id = ?",
                                OffsetDateTime.class,
                                id))
                .isEqualTo(archivedAt);
        assertThat(
                        jdbcTemplate.queryForObject(
                                "SELECT completed_at FROM task WHERE id = ?",
                                OffsetDateTime.class,
                                id))
                .isEqualTo(completedAt);
        assertThat(checklistItemCount(id)).isEqualTo(1);
    }

    @Test
    void repeatDeleteAndRestoreAreSafeForOwner() throws Exception {
        createTask("Repeat lifecycle", "{\"title\":\"Repeat lifecycle\"}");
        Long id = taskIdForTitle("Repeat lifecycle");

        for (int attempt = 0; attempt < 2; attempt++) {
            mockMvc.perform(
                            org.springframework.test.web.servlet.request.MockMvcRequestBuilders
                                    .delete("/api/v1/tasks/{id}", id)
                                    .cookie(ownerCookie))
                    .andExpect(status().isNoContent());
        }
        OffsetDateTime deletedAt =
                jdbcTemplate.queryForObject(
                        "SELECT deleted_at FROM task WHERE id = ?", OffsetDateTime.class, id);
        mockMvc.perform(post("/api/v1/tasks/{id}/restore-deleted", id).cookie(ownerCookie))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.deletedAt").value(org.hamcrest.Matchers.nullValue()));
        assertThat(
                        jdbcTemplate.queryForObject(
                                "SELECT deleted_at FROM task WHERE id = ?",
                                OffsetDateTime.class,
                                id))
                .isNull();
        assertThat(deletedAt).isNotNull();
    }

    @Test
    void otherUserAndMissingLifecycleCommandsReturn404() throws Exception {
        createTask("Private lifecycle target", "{\"title\":\"Private lifecycle target\"}");
        Long id = taskIdForTitle("Private lifecycle target");
        String otherEmail = UUID.randomUUID() + "@example.com";
        userCommandService.register(otherEmail, PASSWORD);
        Cookie otherCookie = login(otherEmail);

        mockMvc.perform(post("/api/v1/tasks/{id}/archive", id).cookie(otherCookie))
                .andExpect(status().isNotFound());
        mockMvc.perform(post("/api/v1/tasks/{id}/restore-deleted", id).cookie(otherCookie))
                .andExpect(status().isNotFound());
        mockMvc.perform(
                        org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete(
                                        "/api/v1/tasks/{id}", id)
                                .cookie(otherCookie))
                .andExpect(status().isNotFound());
        mockMvc.perform(post("/api/v1/tasks/{id}/archive", -1L).cookie(ownerCookie))
                .andExpect(status().isNotFound());
        mockMvc.perform(post("/api/v1/tasks/{id}/restore", -1L).cookie(ownerCookie))
                .andExpect(status().isNotFound());
        mockMvc.perform(post("/api/v1/tasks/{id}/restore-deleted", -1L).cookie(ownerCookie))
                .andExpect(status().isNotFound());
        mockMvc.perform(
                        org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete(
                                        "/api/v1/tasks/{id}", -1L)
                                .cookie(ownerCookie))
                .andExpect(status().isNotFound());
    }

    @Test
    void unauthenticatedLifecycleCommandsReturn401() throws Exception {
        mockMvc.perform(post("/api/v1/tasks/{id}/complete", 1))
                .andExpect(status().isUnauthorized());
        mockMvc.perform(post("/api/v1/tasks/{id}/reopen", 1)).andExpect(status().isUnauthorized());
        mockMvc.perform(post("/api/v1/tasks/{id}/archive", 1L))
                .andExpect(status().isUnauthorized());
        mockMvc.perform(post("/api/v1/tasks/{id}/restore", 1L))
                .andExpect(status().isUnauthorized());
        mockMvc.perform(
                        org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete(
                                "/api/v1/tasks/{id}", 1L))
                .andExpect(status().isUnauthorized());
        mockMvc.perform(post("/api/v1/tasks/{id}/restore-deleted", 1L))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void completeAndReopenPersistThroughGetAndList() throws Exception {
        createTask(
                "Complete lifecycle", "{\"title\":\"Complete lifecycle\",\"priority\":\"HIGH\"}");
        Long id = taskIdForTitle("Complete lifecycle");

        mockMvc.perform(post("/api/v1/tasks/{id}/complete", id).cookie(ownerCookie))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value(id))
                .andExpect(jsonPath("$.title").value("Complete lifecycle"))
                .andExpect(jsonPath("$.priority").value("HIGH"))
                .andExpect(jsonPath("$.completedAt").isNotEmpty());
        assertThat(
                        jdbcTemplate.queryForObject(
                                "SELECT completed_at FROM task WHERE id = ?",
                                OffsetDateTime.class,
                                id))
                .isNotNull();
        mockMvc.perform(get("/api/v1/tasks/{id}", id).cookie(ownerCookie))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.completedAt").isNotEmpty());
        mockMvc.perform(get("/api/v1/tasks").cookie(ownerCookie))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[0].completedAt").isNotEmpty());

        mockMvc.perform(post("/api/v1/tasks/{id}/reopen", id).cookie(ownerCookie))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value(id))
                .andExpect(jsonPath("$.title").value("Complete lifecycle"))
                .andExpect(jsonPath("$.priority").value("HIGH"))
                .andExpect(jsonPath("$.completedAt").doesNotExist());
        assertThat(
                        jdbcTemplate.queryForObject(
                                "SELECT completed_at FROM task WHERE id = ?",
                                OffsetDateTime.class,
                                id))
                .isNull();
        mockMvc.perform(get("/api/v1/tasks/{id}", id).cookie(ownerCookie))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.completedAt").doesNotExist());
    }

    @Test
    void repeatedCompletePreservesOriginalTimestampAndRepeatedReopenIsNull() throws Exception {
        createTask("Idempotent lifecycle", "{\"title\":\"Idempotent lifecycle\"}");
        Long id = taskIdForTitle("Idempotent lifecycle");
        OffsetDateTime original = OffsetDateTime.parse("2026-10-20T12:00:00Z");
        jdbcTemplate.update("UPDATE task SET completed_at = ? WHERE id = ?", original, id);

        MvcResult completed =
                mockMvc.perform(post("/api/v1/tasks/{id}/complete", id).cookie(ownerCookie))
                        .andExpect(status().isOk())
                        .andExpect(jsonPath("$.completedAt").isNotEmpty())
                        .andReturn();
        assertThat(
                        OffsetDateTime.parse(
                                JsonPath.parse(completed.getResponse().getContentAsString())
                                        .read("$.completedAt", String.class)))
                .isEqualTo(original);
        assertThat(
                        jdbcTemplate.queryForObject(
                                "SELECT completed_at FROM task WHERE id = ?",
                                OffsetDateTime.class,
                                id))
                .isEqualTo(original);

        mockMvc.perform(post("/api/v1/tasks/{id}/reopen", id).cookie(ownerCookie))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.completedAt").doesNotExist());
        mockMvc.perform(post("/api/v1/tasks/{id}/reopen", id).cookie(ownerCookie))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.completedAt").doesNotExist());
        assertThat(
                        jdbcTemplate.queryForObject(
                                "SELECT completed_at FROM task WHERE id = ?",
                                OffsetDateTime.class,
                                id))
                .isNull();
    }

    @Test
    void archivedCompletionPreservesArchivedAt() throws Exception {
        createTask("Archived lifecycle", "{\"title\":\"Archived lifecycle\"}");
        Long id = taskIdForTitle("Archived lifecycle");
        OffsetDateTime archivedAt = OffsetDateTime.parse("2026-10-19T09:15:00Z");
        jdbcTemplate.update("UPDATE task SET archived_at = ? WHERE id = ?", archivedAt, id);

        MvcResult completed =
                mockMvc.perform(post("/api/v1/tasks/{id}/complete", id).cookie(ownerCookie))
                        .andExpect(status().isOk())
                        .andExpect(jsonPath("$.completedAt").isNotEmpty())
                        .andExpect(jsonPath("$.archivedAt").isNotEmpty())
                        .andReturn();
        assertThat(
                        OffsetDateTime.parse(
                                JsonPath.parse(completed.getResponse().getContentAsString())
                                        .read("$.archivedAt", String.class)))
                .isEqualTo(archivedAt);
        MvcResult reopened =
                mockMvc.perform(post("/api/v1/tasks/{id}/reopen", id).cookie(ownerCookie))
                        .andExpect(status().isOk())
                        .andExpect(jsonPath("$.completedAt").doesNotExist())
                        .andExpect(jsonPath("$.archivedAt").isNotEmpty())
                        .andReturn();
        assertThat(
                        OffsetDateTime.parse(
                                JsonPath.parse(reopened.getResponse().getContentAsString())
                                        .read("$.archivedAt", String.class)))
                .isEqualTo(archivedAt);
        assertThat(
                        jdbcTemplate.queryForObject(
                                "SELECT archived_at FROM task WHERE id = ?",
                                OffsetDateTime.class,
                                id))
                .isEqualTo(archivedAt);
    }

    @Test
    void deletedAndOtherUserTasksReturn404() throws Exception {
        createTask("Lifecycle owner scope", "{\"title\":\"Lifecycle owner scope\"}");
        Long ownedId = taskIdForTitle("Lifecycle owner scope");
        createTask("Lifecycle deleted", "{\"title\":\"Lifecycle deleted\"}");
        Long deletedId = taskIdForTitle("Lifecycle deleted");
        jdbcTemplate.update(
                "UPDATE task SET deleted_at = ? WHERE id = ?",
                OffsetDateTime.now(ZoneOffset.UTC),
                deletedId);
        String otherEmail = UUID.randomUUID() + "@example.com";
        userCommandService.register(otherEmail, PASSWORD);
        Cookie otherCookie = login(otherEmail);

        MvcResult otherOwnerResult =
                mockMvc.perform(post("/api/v1/tasks/{id}/complete", ownedId).cookie(otherCookie))
                        .andExpect(status().isNotFound())
                        .andReturn();
        MvcResult missingResult =
                mockMvc.perform(
                                post("/api/v1/tasks/{id}/complete", Long.MAX_VALUE)
                                        .cookie(otherCookie))
                        .andExpect(status().isNotFound())
                        .andReturn();
        assertThat(otherOwnerResult.getResponse().getContentAsString())
                .isEqualTo(missingResult.getResponse().getContentAsString());

        mockMvc.perform(post("/api/v1/tasks/{id}/complete", deletedId).cookie(ownerCookie))
                .andExpect(status().isNotFound());
        assertThat(
                        jdbcTemplate.queryForObject(
                                "SELECT completed_at FROM task WHERE id = ?",
                                OffsetDateTime.class,
                                ownedId))
                .isNull();
        assertThat(
                        jdbcTemplate.queryForObject(
                                "SELECT completed_at FROM task WHERE id = ?",
                                OffsetDateTime.class,
                                deletedId))
                .isNull();
    }

    @Test
    void createTitleOnlyReturns201LocationIdAndOwnKey() throws Exception {
        MvcResult result =
                mockMvc.perform(
                                post("/api/v1/tasks")
                                        .cookie(ownerCookie)
                                        .contentType(MediaType.APPLICATION_JSON)
                                        .content("{\"title\":\"Renew passport\"}"))
                        .andExpect(status().isCreated())
                        .andExpect(header().string("Location", containsString("/api/v1/tasks/")))
                        .andExpect(jsonPath("$.id").isNumber())
                        .andExpect(jsonPath("$.key").value("TASK-1"))
                        .andExpect(jsonPath("$.title").value("Renew passport"))
                        .andExpect(jsonPath("$.inbox").value(false))
                        .andReturn();

        Long id =
                JsonPath.parse(result.getResponse().getContentAsString()).read("$.id", Long.class);
        assertThat(result.getResponse().getHeader("Location")).isEqualTo("/api/v1/tasks/" + id);
        mockMvc.perform(get("/api/v1/tasks/{id}", id).cookie(ownerCookie))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.key").value("TASK-1"));
    }

    @Test
    void taskDetailsReturnOrderedChecklistOnGetCreateUpdateCompleteAndReopen() throws Exception {
        String body =
                "{\"title\":\"Checklist detail\",\"checklist\":["
                        + "{\"title\":\"First\",\"dueDate\":\"2026-10-28\"},"
                        + "{\"title\":\"Second\"}]}";
        MvcResult created =
                mockMvc.perform(
                                post("/api/v1/tasks")
                                        .cookie(ownerCookie)
                                        .contentType(MediaType.APPLICATION_JSON)
                                        .content(body))
                        .andExpect(status().isCreated())
                        .andExpect(jsonPath("$.checklist[0].title").value("First"))
                        .andExpect(jsonPath("$.checklist[0].position").value(0))
                        .andExpect(jsonPath("$.checklist[0].dueDate").value("2026-10-28"))
                        .andExpect(jsonPath("$.checklist[1].title").value("Second"))
                        .andExpect(jsonPath("$.checklist[1].position").value(1))
                        .andReturn();
        Long id =
                JsonPath.parse(created.getResponse().getContentAsString()).read("$.id", Long.class);

        mockMvc.perform(get("/api/v1/tasks/{id}", id).cookie(ownerCookie))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.checklist[0].title").value("First"))
                .andExpect(jsonPath("$.checklist[1].title").value("Second"));
        mockMvc.perform(
                        patch("/api/v1/tasks/{id}", id)
                                .cookie(ownerCookie)
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"title\":\"Updated checklist detail\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.checklist[0].title").value("First"));
        mockMvc.perform(post("/api/v1/tasks/{id}/complete", id).cookie(ownerCookie))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.checklist.length()").value(2));
        mockMvc.perform(post("/api/v1/tasks/{id}/reopen", id).cookie(ownerCookie))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.checklist.length()").value(2));
    }

    @Test
    void createWithChecklistIsAtomicOnInvalidChild() throws Exception {
        String requestKey = UUID.randomUUID().toString();
        mockMvc.perform(
                        post("/api/v1/tasks")
                                .cookie(ownerCookie)
                                .header("Idempotency-Key", requestKey)
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        "{\"title\":\"Invalid checklist\",\"checklist\":["
                                                + "{\"title\":\"Valid first\"},"
                                                + "{\"title\":\"  \"}]}"))
                .andExpect(status().isBadRequest());

        assertThat(taskIdCountForTitle("Invalid checklist")).isZero();
        assertThat(
                        jdbcTemplate.queryForObject(
                                "SELECT COUNT(*) FROM task_creation_request WHERE request_key = ?",
                                Long.class,
                                UUID.fromString(requestKey)))
                .isZero();
    }

    @Test
    void keyedChecklistReplayDoesNotDuplicateAndChangedDateOrOrderConflicts() throws Exception {
        String requestKey = UUID.randomUUID().toString();
        String body =
                "{\"title\":\"Keyed checklist\",\"checklist\":["
                        + "{\"title\":\"First\",\"dueDate\":\"2026-10-28\"},"
                        + "{\"title\":\"Second\"}]}";
        MvcResult created =
                mockMvc.perform(
                                post("/api/v1/tasks")
                                        .cookie(ownerCookie)
                                        .header("Idempotency-Key", requestKey)
                                        .contentType(MediaType.APPLICATION_JSON)
                                        .content(body))
                        .andExpect(status().isCreated())
                        .andReturn();
        Long id =
                JsonPath.parse(created.getResponse().getContentAsString()).read("$.id", Long.class);
        mockMvc.perform(
                        post("/api/v1/tasks")
                                .cookie(ownerCookie)
                                .header("Idempotency-Key", requestKey)
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(body))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.checklist.length()").value(2));
        assertThat(checklistItemCount(id)).isEqualTo(2L);

        mockMvc.perform(
                        post("/api/v1/tasks")
                                .cookie(ownerCookie)
                                .header("Idempotency-Key", requestKey)
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(body.replace("2026-10-28", "2026-10-29")))
                .andExpect(status().isConflict());
        mockMvc.perform(
                        post("/api/v1/tasks")
                                .cookie(ownerCookie)
                                .header("Idempotency-Key", requestKey)
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        "{\"title\":\"Keyed checklist\",\"checklist\":["
                                            + "{\"title\":\"Second\"},"
                                            + "{\"title\":\"First\",\"dueDate\":\"2026-10-28\"}]}"))
                .andExpect(status().isConflict());
        assertThat(checklistItemCount(id)).isEqualTo(2L);
    }

    @Test
    void listSummaryDoesNotContainChecklist() throws Exception {
        createTask(
                "Checklist summary",
                "{\"title\":\"Checklist summary\",\"checklist\":["
                        + "{\"title\":\"Hidden from summary\"}]}");

        mockMvc.perform(get("/api/v1/tasks").cookie(ownerCookie))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[0].checklist").doesNotExist());
    }

    @Test
    void keyedCreateReplayReturnsSameTaskAndLocation() throws Exception {
        String requestKey = UUID.randomUUID().toString();
        String body = "{\"title\":\"Keyed create\"}";
        MvcResult first =
                mockMvc.perform(
                                post("/api/v1/tasks")
                                        .cookie(ownerCookie)
                                        .header("Idempotency-Key", requestKey)
                                        .contentType(MediaType.APPLICATION_JSON)
                                        .content(body))
                        .andExpect(status().isCreated())
                        .andExpect(jsonPath("$.key").value("TASK-1"))
                        .andExpect(jsonPath("$.inbox").value(false))
                        .andReturn();
        MvcResult replay =
                mockMvc.perform(
                                post("/api/v1/tasks")
                                        .cookie(ownerCookie)
                                        .header("Idempotency-Key", requestKey)
                                        .contentType(MediaType.APPLICATION_JSON)
                                        .content(body))
                        .andExpect(status().isCreated())
                        .andExpect(jsonPath("$.key").value("TASK-1"))
                        .andExpect(jsonPath("$.inbox").value(false))
                        .andReturn();
        Long firstId =
                JsonPath.parse(first.getResponse().getContentAsString()).read("$.id", Long.class);
        Long replayId =
                JsonPath.parse(replay.getResponse().getContentAsString()).read("$.id", Long.class);

        assertThat(replayId).isEqualTo(firstId);
        assertThat(replay.getResponse().getHeader("Location"))
                .isEqualTo(first.getResponse().getHeader("Location"));
        assertThat(taskIdCountForTitle("Keyed create")).isEqualTo(1L);
        assertThat(
                        jdbcTemplate.queryForObject(
                                "SELECT last_allocated FROM task_key_counter WHERE user_id ="
                                        + " (SELECT id FROM users WHERE email = ?)",
                                Long.class,
                                ownerEmail))
                .isEqualTo(1L);
    }

    @Test
    void reusedKeyWithDifferentBodyReturnsProblemConflict() throws Exception {
        String requestKey = UUID.randomUUID().toString();
        mockMvc.perform(
                        post("/api/v1/tasks")
                                .cookie(ownerCookie)
                                .header("Idempotency-Key", requestKey)
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"title\":\"Original request\"}"))
                .andExpect(status().isCreated());

        MvcResult conflict =
                mockMvc.perform(
                                post("/api/v1/tasks")
                                        .cookie(ownerCookie)
                                        .header("Idempotency-Key", requestKey)
                                        .contentType(MediaType.APPLICATION_JSON)
                                        .content("{\"title\":\"Changed request\"}"))
                        .andExpect(status().isConflict())
                        .andExpect(jsonPath("$.status").value(409))
                        .andReturn();

        assertThat(conflict.getResponse().getContentType()).contains("application/problem+json");
        assertThat(taskIdCountForTitle("Original request")).isEqualTo(1L);
        assertThat(taskIdCountForTitle("Changed request")).isZero();
    }

    @Test
    void sameRequestKeyIsIndependentAcrossOwners() throws Exception {
        String requestKey = UUID.randomUUID().toString();
        MvcResult first =
                mockMvc.perform(
                                post("/api/v1/tasks")
                                        .cookie(ownerCookie)
                                        .header("Idempotency-Key", requestKey)
                                        .contentType(MediaType.APPLICATION_JSON)
                                        .content("{\"title\":\"Owner one\"}"))
                        .andExpect(status().isCreated())
                        .andReturn();
        String otherEmail = UUID.randomUUID() + "@example.com";
        userCommandService.register(otherEmail, PASSWORD);
        Cookie otherCookie = login(otherEmail);
        MvcResult second =
                mockMvc.perform(
                                post("/api/v1/tasks")
                                        .cookie(otherCookie)
                                        .header("Idempotency-Key", requestKey)
                                        .contentType(MediaType.APPLICATION_JSON)
                                        .content("{\"title\":\"Owner two\"}"))
                        .andExpect(status().isCreated())
                        .andExpect(jsonPath("$.key").value("TASK-1"))
                        .andReturn();

        Long firstId =
                JsonPath.parse(first.getResponse().getContentAsString()).read("$.id", Long.class);
        Long secondId =
                JsonPath.parse(second.getResponse().getContentAsString()).read("$.id", Long.class);
        assertThat(secondId).isNotEqualTo(firstId);
    }

    @Test
    void invalidIdempotencyKeysReturn400WithoutCreatingTasks() throws Exception {
        for (String requestKey : new String[] {"", "not-a-uuid"}) {
            MvcResult result =
                    mockMvc.perform(
                                    post("/api/v1/tasks")
                                            .cookie(ownerCookie)
                                            .header("Idempotency-Key", requestKey)
                                            .contentType(MediaType.APPLICATION_JSON)
                                            .content("{\"title\":\"Invalid key\"}"))
                            .andExpect(status().isBadRequest())
                            .andReturn();
            assertThat(
                            JsonPath.parse(result.getResponse().getContentAsString())
                                    .read("$.title", String.class))
                    .isEqualTo("Validation Failed");
        }
        assertThat(taskIdCountForTitle("Invalid key")).isZero();
    }

    @Test
    void replayAfterSoftDeleteConflictsWithoutCreatingAnotherTask() throws Exception {
        String requestKey = UUID.randomUUID().toString();
        String body = "{\"title\":\"Deleted keyed create\"}";
        MvcResult created =
                mockMvc.perform(
                                post("/api/v1/tasks")
                                        .cookie(ownerCookie)
                                        .header("Idempotency-Key", requestKey)
                                        .contentType(MediaType.APPLICATION_JSON)
                                        .content(body))
                        .andExpect(status().isCreated())
                        .andReturn();
        Long taskId =
                JsonPath.parse(created.getResponse().getContentAsString()).read("$.id", Long.class);
        jdbcTemplate.update(
                "UPDATE task SET deleted_at = ? WHERE id = ?",
                OffsetDateTime.now(ZoneOffset.UTC),
                taskId);

        mockMvc.perform(
                        post("/api/v1/tasks")
                                .cookie(ownerCookie)
                                .header("Idempotency-Key", requestKey)
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(body))
                .andExpect(status().isConflict());

        assertThat(taskIdCountForTitle("Deleted keyed create")).isEqualTo(1L);
    }

    @Test
    void optionalFieldsRoundTripInDetail() throws Exception {
        mockMvc.perform(
                        post("/api/v1/tasks")
                                .cookie(ownerCookie)
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        "{\"title\":\"Write"
                                            + " docs\",\"description\":{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"text\":\"Nested\"}]}]},\"priority\":\"HIGH\",\"dueDate\":\"2026-10-20\"}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.description.type").value("doc"))
                .andExpect(jsonPath("$.description.content[0].content[0].text").value("Nested"))
                .andExpect(jsonPath("$.priority").value("HIGH"))
                .andExpect(jsonPath("$.dueDate").value("2026-10-20"));
    }

    @Test
    void richDescriptionCreatesReplaysAndReloadsWithoutLeakingIntoList() throws Exception {
        String requestKey = UUID.randomUUID().toString();
        String body =
                "{\"title\":\"Rich create\",\"description\":{\"type\":\"doc\",\"content\":["
                    + "{\"type\":\"heading\",\"attrs\":{\"level\":2},\"content\":[{\"type\":\"text\",\"text\":\"Plan\"}]},{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"text\":\"Read\",\"marks\":[{\"type\":\"bold\"}]},{\"type\":\"text\",\"text\":\""
                    + " more\",\"marks\":[{\"type\":\"link\",\"attrs\":{\"href\":\"https://example.com/docs\",\"target\":\"_blank\",\"rel\":\"noopener"
                    + " noreferrer nofollow\",\"class\":null,\"title\":null}}]}]},"
                    + "{\"type\":\"table\",\"content\":[{\"type\":\"tableRow\",\"content\":[{\"type\":\"tableHeader\",\"attrs\":{\"colspan\":1,\"rowspan\":1,\"colwidth\":null,\"align\":null},\"content\":[{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"text\":\"Owner\"}]}]},{\"type\":\"tableCell\",\"attrs\":{\"colspan\":1,\"rowspan\":1,\"colwidth\":null,\"align\":null},\"content\":[{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"text\":\"Mira\"}]}]}]}]},"
                    + "{\"type\":\"horizontalRule\"}]}}";

        MvcResult created =
                mockMvc.perform(
                                post("/api/v1/tasks")
                                        .cookie(ownerCookie)
                                        .header("Idempotency-Key", requestKey)
                                        .contentType(MediaType.APPLICATION_JSON)
                                        .content(body))
                        .andExpect(status().isCreated())
                        .andExpect(jsonPath("$.description.content[0].type").value("heading"))
                        .andExpect(
                                jsonPath("$.description.content[1].content[0].marks[0].type")
                                        .value("bold"))
                        .andExpect(jsonPath("$.description.content[2].type").value("table"))
                        .andExpect(
                                jsonPath("$.description.content[3].type").value("horizontalRule"))
                        .andReturn();
        Long id =
                JsonPath.parse(created.getResponse().getContentAsString()).read("$.id", Long.class);

        mockMvc.perform(
                        post("/api/v1/tasks")
                                .cookie(ownerCookie)
                                .header("Idempotency-Key", requestKey)
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(body))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.id").value(id));
        mockMvc.perform(get("/api/v1/tasks/{id}", id).cookie(ownerCookie))
                .andExpect(status().isOk())
                .andExpect(
                        jsonPath("$.description.content[1].content[1].marks[0].attrs.href")
                                .value("https://example.com/docs"))
                .andExpect(
                        jsonPath("$.description.content[2].content[0].content[0].type")
                                .value("tableHeader"));
        mockMvc.perform(get("/api/v1/tasks").cookie(ownerCookie))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[0].description").doesNotExist());
    }

    @Test
    void richDescriptionPatchReplacesClearsAndAllowsCompletedArchivedTasks() throws Exception {
        createTask(
                "Rich patch",
                "{\"title\":\"Rich"
                    + " patch\",\"description\":{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"text\":\"Before\"}]}]}}");
        Long id = taskIdForTitle("Rich patch");
        jdbcTemplate.update(
                "UPDATE task SET completed_at = ?, archived_at = ? WHERE id = ?",
                OffsetDateTime.now(ZoneOffset.UTC),
                OffsetDateTime.now(ZoneOffset.UTC),
                id);
        String replacement =
                "{\"type\":\"doc\",\"content\":[{\"type\":\"bulletList\",\"content\":[{\"type\":\"listItem\",\"content\":[{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"text\":\"After\",\"marks\":[{\"type\":\"italic\"}]}]}]}]}]}";
        MvcResult before =
                mockMvc.perform(get("/api/v1/tasks/{id}", id).cookie(ownerCookie))
                        .andExpect(status().isOk())
                        .andReturn();
        String oldUpdatedAt =
                JsonPath.parse(before.getResponse().getContentAsString())
                        .read("$.updatedAt", String.class);
        Thread.sleep(10);

        mockMvc.perform(
                        patch("/api/v1/tasks/{id}", id)
                                .cookie(ownerCookie)
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"description\":" + replacement + "}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.description.content[0].type").value("bulletList"))
                .andExpect(jsonPath("$.updatedAt").value(org.hamcrest.Matchers.not(oldUpdatedAt)));
        mockMvc.perform(get("/api/v1/tasks/{id}", id).cookie(ownerCookie))
                .andExpect(status().isOk())
                .andExpect(
                        jsonPath("$.description.content[0].content[0].content[0].content[0].text")
                                .value("After"));
        mockMvc.perform(
                        patch("/api/v1/tasks/{id}", id)
                                .cookie(ownerCookie)
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"description\":null}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.description").value(org.hamcrest.Matchers.nullValue()));
    }

    @Test
    void invalidRichDescriptionsReturnFieldErrorsAndPatchDoesNotMutateTask() throws Exception {
        createTask(
                "Invalid rich patch",
                "{\"title\":\"Invalid rich"
                    + " patch\",\"description\":{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"text\":\"Keep\"}]}]}}");
        Long id = taskIdForTitle("Invalid rich patch");
        MvcResult before =
                mockMvc.perform(get("/api/v1/tasks/{id}", id).cookie(ownerCookie))
                        .andExpect(status().isOk())
                        .andReturn();
        String beforeJson = before.getResponse().getContentAsString();
        String beforeDescription = JsonPath.parse(beforeJson).read("$.description").toString();
        String beforeUpdatedAt = JsonPath.parse(beforeJson).read("$.updatedAt", String.class);
        String deeplyNested =
                "{\"type\":\"doc\",\"content\":["
                        + "{\"type\":\"blockquote\",\"content\":[".repeat(32)
                        + "{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"text\":\"x\"}]}"
                        + "]}".repeat(32)
                        + "]}";
        String[] invalidDocuments = {
            "{\"type\":\"doc\",\"content\":[{\"type\":\"unknown\"}]}",
            "{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"text\":\"x\",\"marks\":[{\"type\":\"strike\"}]}]}]}",
            "{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"text\":\"x\",\"marks\":[{\"type\":\"link\",\"attrs\":{\"href\":\"javascript:alert(1)\"}}]}]}]}",
            "{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"text\":\"x\",\"marks\":[{\"type\":\"link\",\"attrs\":{\"href\":\"https://example.com\",\"target\":\"_self\"}}]}]}]}",
            "{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"text\":\"x\",\"marks\":[{\"type\":\"link\",\"attrs\":{\"href\":\"https://example.com\",\"rel\":\"nofollow\"}}]}]}]}",
            "{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"text\":\"x\",\"marks\":[{\"type\":\"link\",\"attrs\":{\"href\":\"https://example.com\",\"rel\":\"noopener\"}}]}]}]}",
            deeplyNested,
            "{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"text\":\""
                    + "x".repeat(270_000)
                    + "\"}]}]}"
        };

        for (String invalidDocument : invalidDocuments) {
            mockMvc.perform(
                            post("/api/v1/tasks")
                                    .cookie(ownerCookie)
                                    .contentType(MediaType.APPLICATION_JSON)
                                    .content(
                                            "{\"title\":\"Invalid posted doc\",\"description\":"
                                                    + invalidDocument
                                                    + "}"))
                    .andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.errors.description").exists());
            mockMvc.perform(
                            patch("/api/v1/tasks/{id}", id)
                                    .cookie(ownerCookie)
                                    .contentType(MediaType.APPLICATION_JSON)
                                    .content("{\"description\":" + invalidDocument + "}"))
                    .andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.errors.description").exists());
        }

        MvcResult after =
                mockMvc.perform(get("/api/v1/tasks/{id}", id).cookie(ownerCookie))
                        .andExpect(status().isOk())
                        .andReturn();
        String afterJson = after.getResponse().getContentAsString();
        assertThat(JsonPath.parse(afterJson).read("$.description").toString())
                .isEqualTo(beforeDescription);
        assertThat(JsonPath.parse(afterJson).read("$.updatedAt", String.class))
                .isEqualTo(beforeUpdatedAt);
        assertThat(taskIdCountForTitle("Invalid posted doc")).isZero();
    }

    @Test
    void listReturnsEnvelopeAndOmitsDescription() throws Exception {
        createTask(
                "List item",
                "{\"title\":\"List item\",\"description\":{\"type\":\"doc\",\"content\":[]}}");

        mockMvc.perform(get("/api/v1/tasks").cookie(ownerCookie))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(1))
                .andExpect(jsonPath("$.items[0].title").value("List item"))
                .andExpect(jsonPath("$.items[0].description").doesNotExist())
                .andExpect(
                        org.springframework.test.web.servlet.result.MockMvcResultMatchers.content()
                                .string(not(containsString("description"))));
    }

    @Test
    void listIncludesOwnArchivedAndCompletedButNotDeleted() throws Exception {
        createTask("Completed", "{\"title\":\"Completed\"}");
        createTask("Archived", "{\"title\":\"Archived\"}");
        createTask("Deleted", "{\"title\":\"Deleted\"}");
        createTask("Active", "{\"title\":\"Active\"}");
        jdbcTemplate.update(
                "UPDATE task SET completed_at = ? WHERE title = ?",
                OffsetDateTime.now(ZoneOffset.UTC),
                "Completed");
        jdbcTemplate.update(
                "UPDATE task SET archived_at = ? WHERE title = ?",
                OffsetDateTime.now(ZoneOffset.UTC),
                "Archived");
        jdbcTemplate.update(
                "UPDATE task SET deleted_at = ? WHERE title = ?",
                OffsetDateTime.now(ZoneOffset.UTC),
                "Deleted");

        mockMvc.perform(get("/api/v1/tasks").cookie(ownerCookie))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(3))
                .andExpect(
                        jsonPath("$.items[*].title")
                                .value(
                                        org.hamcrest.Matchers.containsInAnyOrder(
                                                "Completed", "Archived", "Active")));
    }

    @Test
    void listNewestFirst() throws Exception {
        createTask("Older", "{\"title\":\"Older\"}");
        createTask("Newer", "{\"title\":\"Newer\"}");
        jdbcTemplate.update(
                "UPDATE task SET created_at = ? WHERE title = ?",
                OffsetDateTime.of(2026, 10, 17, 8, 0, 0, 0, ZoneOffset.UTC),
                "Older");
        jdbcTemplate.update(
                "UPDATE task SET created_at = ? WHERE title = ?",
                OffsetDateTime.of(2026, 10, 17, 9, 0, 0, 0, ZoneOffset.UTC),
                "Newer");

        mockMvc.perform(get("/api/v1/tasks").cookie(ownerCookie))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[0].title").value("Newer"))
                .andExpect(jsonPath("$.items[1].title").value("Older"));
    }

    @Test
    void otherOwnerAndMissingGetReturnSame404() throws Exception {
        createTask("Owned by first user", "{\"title\":\"Owned by first user\"}");
        Long taskId = taskIdForTitle("Owned by first user");
        String otherEmail = UUID.randomUUID() + "@example.com";
        userCommandService.register(otherEmail, PASSWORD);
        Cookie otherCookie = login(otherEmail);

        MvcResult otherOwnerResult =
                mockMvc.perform(get("/api/v1/tasks/{id}", taskId).cookie(otherCookie))
                        .andExpect(status().isNotFound())
                        .andReturn();
        MvcResult missingResult =
                mockMvc.perform(get("/api/v1/tasks/{id}", Long.MAX_VALUE).cookie(otherCookie))
                        .andExpect(status().isNotFound())
                        .andReturn();

        assertThat(otherOwnerResult.getResponse().getContentAsString())
                .isEqualTo(missingResult.getResponse().getContentAsString());
    }

    @Test
    void blankOrLongTitleReturnsStandard400() throws Exception {
        mockMvc.perform(
                        post("/api/v1/tasks")
                                .cookie(ownerCookie)
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"title\":\"   \"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.title").value("Validation Failed"));
        mockMvc.perform(
                        post("/api/v1/tasks")
                                .cookie(ownerCookie)
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"title\":\"" + "x".repeat(256) + "\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.title").value("Validation Failed"));
    }

    @Test
    void invalidJsonEnvelopeDoesNotInsert() throws Exception {
        mockMvc.perform(
                        post("/api/v1/tasks")
                                .cookie(ownerCookie)
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        "{\"title\":\"Invalid"
                                            + " document\",\"description\":{\"type\":\"paragraph\"}}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.title").value("Validation Failed"))
                .andExpect(jsonPath("$.errors.description").exists());

        assertThat(taskIdCountForTitle("Invalid document")).isZero();
    }

    @Test
    void invalidPriorityOrDateReturns400() throws Exception {
        mockMvc.perform(
                        post("/api/v1/tasks")
                                .cookie(ownerCookie)
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"title\":\"Bad priority\",\"priority\":\"URGENT\"}"))
                .andExpect(status().isBadRequest());
        mockMvc.perform(
                        post("/api/v1/tasks")
                                .cookie(ownerCookie)
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"title\":\"Bad date\",\"dueDate\":\"not-a-date\"}"))
                .andExpect(status().isBadRequest());
    }

    @Test
    void postAndPatchInvalidPriorityReturnSameFieldValidationShape() throws Exception {
        createTask(
                "Priority validation target",
                "{\"title\":\"Priority validation"
                        + " target\",\"priority\":\"HIGH\",\"dueDate\":\"2026-10-20\"}");
        Long id = taskIdForTitle("Priority validation target");

        String postPriorityValueError =
                assertFieldValidation(
                        mockMvc.perform(
                                        post("/api/v1/tasks")
                                                .cookie(ownerCookie)
                                                .contentType(MediaType.APPLICATION_JSON)
                                                .content(
                                                        "{\"title\":\"Invalid priority"
                                                            + " value\",\"priority\":\"URGENT\"}"))
                                .andReturn(),
                        "priority");
        String postPriorityTypeError =
                assertFieldValidation(
                        mockMvc.perform(
                                        post("/api/v1/tasks")
                                                .cookie(ownerCookie)
                                                .contentType(MediaType.APPLICATION_JSON)
                                                .content(
                                                        "{\"title\":\"Invalid priority"
                                                                + " type\",\"priority\":42}"))
                                .andReturn(),
                        "priority");
        assertThat(
                        assertFieldValidation(
                                mockMvc.perform(
                                                patch("/api/v1/tasks/{id}", id)
                                                        .cookie(ownerCookie)
                                                        .contentType(MediaType.APPLICATION_JSON)
                                                        .content("{\"priority\":\"URGENT\"}"))
                                        .andReturn(),
                                "priority"))
                .isEqualTo(postPriorityValueError);
        assertThat(
                        assertFieldValidation(
                                mockMvc.perform(
                                                patch("/api/v1/tasks/{id}", id)
                                                        .cookie(ownerCookie)
                                                        .contentType(MediaType.APPLICATION_JSON)
                                                        .content("{\"priority\":42}"))
                                        .andReturn(),
                                "priority"))
                .isEqualTo(postPriorityTypeError);

        assertThat(taskIdCountForTitle("Invalid priority value")).isZero();
        assertThat(taskIdCountForTitle("Invalid priority type")).isZero();
        mockMvc.perform(get("/api/v1/tasks/{id}", id).cookie(ownerCookie))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.priority").value("HIGH"))
                .andExpect(jsonPath("$.dueDate").value("2026-10-20"));
    }

    @Test
    void postAndPatchInvalidDueDateReturnSameFieldValidationShape() throws Exception {
        createTask(
                "Date validation target",
                "{\"title\":\"Date validation"
                        + " target\",\"priority\":\"HIGH\",\"dueDate\":\"2026-10-20\"}");
        Long id = taskIdForTitle("Date validation target");

        String postDateValueError =
                assertFieldValidation(
                        mockMvc.perform(
                                        post("/api/v1/tasks")
                                                .cookie(ownerCookie)
                                                .contentType(MediaType.APPLICATION_JSON)
                                                .content(
                                                        "{\"title\":\"Invalid date"
                                                            + " value\",\"dueDate\":\"not-a-date\"}"))
                                .andReturn(),
                        "dueDate");
        String postDateTypeError =
                assertFieldValidation(
                        mockMvc.perform(
                                        post("/api/v1/tasks")
                                                .cookie(ownerCookie)
                                                .contentType(MediaType.APPLICATION_JSON)
                                                .content(
                                                        "{\"title\":\"Invalid date"
                                                                + " type\",\"dueDate\":42}"))
                                .andReturn(),
                        "dueDate");
        assertThat(
                        assertFieldValidation(
                                mockMvc.perform(
                                                patch("/api/v1/tasks/{id}", id)
                                                        .cookie(ownerCookie)
                                                        .contentType(MediaType.APPLICATION_JSON)
                                                        .content("{\"dueDate\":\"not-a-date\"}"))
                                        .andReturn(),
                                "dueDate"))
                .isEqualTo(postDateValueError);
        assertThat(
                        assertFieldValidation(
                                mockMvc.perform(
                                                patch("/api/v1/tasks/{id}", id)
                                                        .cookie(ownerCookie)
                                                        .contentType(MediaType.APPLICATION_JSON)
                                                        .content("{\"dueDate\":42}"))
                                        .andReturn(),
                                "dueDate"))
                .isEqualTo(postDateTypeError);

        assertThat(taskIdCountForTitle("Invalid date value")).isZero();
        assertThat(taskIdCountForTitle("Invalid date type")).isZero();
        mockMvc.perform(get("/api/v1/tasks/{id}", id).cookie(ownerCookie))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.priority").value("HIGH"))
                .andExpect(jsonPath("$.dueDate").value("2026-10-20"));
    }

    @Test
    void createKeepsOptionalNullsAndMalformedJsonUsesGlobalResponse() throws Exception {
        mockMvc.perform(
                        post("/api/v1/tasks")
                                .cookie(ownerCookie)
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"title\":\"  Normalized title  \"}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.title").value("Normalized title"))
                .andExpect(jsonPath("$.priority").value(org.hamcrest.Matchers.nullValue()))
                .andExpect(jsonPath("$.dueDate").value(org.hamcrest.Matchers.nullValue()));
        Long normalizedTaskId = taskIdForTitle("Normalized title");
        mockMvc.perform(
                        post("/api/v1/tasks")
                                .cookie(ownerCookie)
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        "{\"title\":\"Explicit"
                                                + " nulls\",\"priority\":null,\"dueDate\":null}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.priority").value(org.hamcrest.Matchers.nullValue()))
                .andExpect(jsonPath("$.dueDate").value(org.hamcrest.Matchers.nullValue()));

        mockMvc.perform(
                        post("/api/v1/tasks")
                                .cookie(ownerCookie)
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"title\":"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.title").value("Malformed JSON Request"));
        mockMvc.perform(
                        patch("/api/v1/tasks/{id}", normalizedTaskId)
                                .cookie(ownerCookie)
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"title\":"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.title").value("Malformed JSON Request"));
        mockMvc.perform(get("/api/v1/tasks/{id}", normalizedTaskId).cookie(ownerCookie))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.title").value("Normalized title"));
        assertThat(taskIdCountForTitle("Normalized title")).isEqualTo(1);
        assertThat(taskIdCountForTitle("Explicit nulls")).isEqualTo(1);
    }

    @Test
    void patchPriorityOnlyPreservesOtherFields() throws Exception {
        createTask(
                "Priority patch",
                "{\"title\":\"Priority"
                    + " patch\",\"description\":{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"text\":\"Keep\"}]}]},\"dueDate\":\"2026-10-20\"}");
        Long id = taskIdForTitle("Priority patch");

        mockMvc.perform(
                        patch("/api/v1/tasks/{id}", id)
                                .cookie(ownerCookie)
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"priority\":\"LOW\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.priority").value("LOW"))
                .andExpect(jsonPath("$.description.type").value("doc"))
                .andExpect(jsonPath("$.dueDate").value("2026-10-20"));
    }

    @Test
    void patchNullClearsPriorityDueDateDescription() throws Exception {
        createTask(
                "Clear optional",
                "{\"title\":\"Clear"
                    + " optional\",\"description\":{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"text\":\"Clear"
                    + " me\"}]}]},\"priority\":\"HIGH\",\"dueDate\":\"2026-10-20\"}");
        Long id = taskIdForTitle("Clear optional");

        mockMvc.perform(
                        patch("/api/v1/tasks/{id}", id)
                                .cookie(ownerCookie)
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        "{\"description\":null,\"priority\":null,\"dueDate\":null}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.description").value(org.hamcrest.Matchers.nullValue()))
                .andExpect(jsonPath("$.priority").value(org.hamcrest.Matchers.nullValue()))
                .andExpect(jsonPath("$.dueDate").value(org.hamcrest.Matchers.nullValue()));
    }

    @Test
    void patchOmittedDescriptionLeavesItIntact() throws Exception {
        createTask(
                "Keep description",
                "{\"title\":\"Keep"
                    + " description\",\"description\":{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"text\":\"Preserve"
                    + " this\"}]}]}}");
        Long id = taskIdForTitle("Keep description");

        mockMvc.perform(
                        patch("/api/v1/tasks/{id}", id)
                                .cookie(ownerCookie)
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"dueDate\":\"2026-10-21\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.description.type").value("doc"))
                .andExpect(jsonPath("$.description.content[0].type").value("paragraph"))
                .andExpect(jsonPath("$.dueDate").value("2026-10-21"));
    }

    @Test
    void patchTitleStripsWhitespaceAndRejectsBlank() throws Exception {
        createTask("Normalize patch title", "{\"title\":\"Before\"}");
        Long id = taskIdForTitle("Before");

        mockMvc.perform(
                        patch("/api/v1/tasks/{id}", id)
                                .cookie(ownerCookie)
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"title\":\"  After  \"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.title").value("After"));
        mockMvc.perform(
                        patch("/api/v1/tasks/{id}", id)
                                .cookie(ownerCookie)
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"title\":\"  \"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.title").value("Validation Failed"));
        mockMvc.perform(get("/api/v1/tasks/{id}", id).cookie(ownerCookie))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.title").value("After"));
    }

    @Test
    void patchEmptyObjectOrImmutableFieldReturns400() throws Exception {
        createTask("Reject patch", "{\"title\":\"Reject patch\"}");
        Long id = taskIdForTitle("Reject patch");

        mockMvc.perform(
                        patch("/api/v1/tasks/{id}", id)
                                .cookie(ownerCookie)
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.title").value("Validation Failed"));
        mockMvc.perform(
                        patch("/api/v1/tasks/{id}", id)
                                .cookie(ownerCookie)
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"userId\":99}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.title").value("Validation Failed"));
        mockMvc.perform(
                        patch("/api/v1/tasks/{id}", id)
                                .cookie(ownerCookie)
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"key\":\"TASK-99\"}"))
                .andExpect(status().isBadRequest());
    }

    @Test
    void patchMalformedDateOrInvalidPriorityReturns400() throws Exception {
        createTask("Bad patch values", "{\"title\":\"Bad patch values\"}");
        Long id = taskIdForTitle("Bad patch values");

        mockMvc.perform(
                        patch("/api/v1/tasks/{id}", id)
                                .cookie(ownerCookie)
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"dueDate\":\"not-a-date\"}"))
                .andExpect(status().isBadRequest());
        mockMvc.perform(
                        patch("/api/v1/tasks/{id}", id)
                                .cookie(ownerCookie)
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"priority\":\"URGENT\"}"))
                .andExpect(status().isBadRequest());
        mockMvc.perform(
                        patch("/api/v1/tasks/{id}", id)
                                .cookie(ownerCookie)
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"description\":\"not a document\"}"))
                .andExpect(status().isBadRequest());
        mockMvc.perform(get("/api/v1/tasks/{id}", id).cookie(ownerCookie))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.title").value("Bad patch values"))
                .andExpect(jsonPath("$.priority").value(org.hamcrest.Matchers.nullValue()))
                .andExpect(jsonPath("$.dueDate").value(org.hamcrest.Matchers.nullValue()));
    }

    @Test
    void patchWrongTypeReturns400() throws Exception {
        createTask("Wrong patch type", "{\"title\":\"Wrong patch type\"}");
        Long id = taskIdForTitle("Wrong patch type");

        mockMvc.perform(
                        patch("/api/v1/tasks/{id}", id)
                                .cookie(ownerCookie)
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"title\":17}"))
                .andExpect(status().isBadRequest());
        mockMvc.perform(
                        patch("/api/v1/tasks/{id}", id)
                                .cookie(ownerCookie)
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"title\":null}"))
                .andExpect(status().isBadRequest());
        mockMvc.perform(
                        patch("/api/v1/tasks/{id}", id)
                                .cookie(ownerCookie)
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"description\":[]}"))
                .andExpect(status().isBadRequest());
        mockMvc.perform(get("/api/v1/tasks/{id}", id).cookie(ownerCookie))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.title").value("Wrong patch type"));
    }

    @Test
    void patchMissingAndOtherOwnerReturnSame404() throws Exception {
        createTask("Patch owner", "{\"title\":\"Patch owner\"}");
        Long id = taskIdForTitle("Patch owner");
        String otherEmail = UUID.randomUUID() + "@example.com";
        userCommandService.register(otherEmail, PASSWORD);
        Cookie otherCookie = login(otherEmail);
        String body = "{\"title\":\"Changed\"}";

        MvcResult otherOwnerResult =
                mockMvc.perform(
                                patch("/api/v1/tasks/{id}", id)
                                        .cookie(otherCookie)
                                        .contentType(MediaType.APPLICATION_JSON)
                                        .content(body))
                        .andExpect(status().isNotFound())
                        .andReturn();
        MvcResult missingResult =
                mockMvc.perform(
                                patch("/api/v1/tasks/{id}", Long.MAX_VALUE)
                                        .cookie(otherCookie)
                                        .contentType(MediaType.APPLICATION_JSON)
                                        .content(body))
                        .andExpect(status().isNotFound())
                        .andReturn();

        assertThat(otherOwnerResult.getResponse().getContentAsString())
                .isEqualTo(missingResult.getResponse().getContentAsString());
    }

    @Test
    void patchUpdatesTimestampPreservingIdKeyCreatedAt() throws Exception {
        createTask("Timestamp patch", "{\"title\":\"Timestamp patch\"}");
        Long id = taskIdForTitle("Timestamp patch");
        MvcResult before =
                mockMvc.perform(get("/api/v1/tasks/{id}", id).cookie(ownerCookie))
                        .andExpect(status().isOk())
                        .andReturn();
        String beforeJson = before.getResponse().getContentAsString();
        String createdAt = JsonPath.parse(beforeJson).read("$.createdAt", String.class);
        String updatedAt = JsonPath.parse(beforeJson).read("$.updatedAt", String.class);
        String key = JsonPath.parse(beforeJson).read("$.key", String.class);
        Thread.sleep(10);

        mockMvc.perform(
                        patch("/api/v1/tasks/{id}", id)
                                .cookie(ownerCookie)
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"title\":\"Timestamp changed\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value(id))
                .andExpect(jsonPath("$.key").value(key))
                .andExpect(jsonPath("$.createdAt").value(createdAt))
                .andExpect(jsonPath("$.updatedAt").value(org.hamcrest.Matchers.not(updatedAt)));
    }

    @Test
    void patchOnDeletedTaskReturns404() throws Exception {
        createTask("Deleted patch", "{\"title\":\"Deleted patch\"}");
        Long id = taskIdForTitle("Deleted patch");
        jdbcTemplate.update(
                "UPDATE task SET deleted_at = ? WHERE id = ?",
                OffsetDateTime.now(ZoneOffset.UTC),
                id);

        mockMvc.perform(
                        patch("/api/v1/tasks/{id}", id)
                                .cookie(ownerCookie)
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"title\":\"Cannot update\"}"))
                .andExpect(status().isNotFound());
    }

    private void createTask(String title, String body) throws Exception {
        mockMvc.perform(
                        post("/api/v1/tasks")
                                .cookie(ownerCookie)
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(body))
                .andExpect(status().isCreated());
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

    private Long taskIdForTitle(String title) {
        return jdbcTemplate.queryForObject(
                "SELECT id FROM task WHERE title = ?", Long.class, title);
    }

    private long taskIdCountForTitle(String title) {
        return jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM task WHERE title = ?", Long.class, title);
    }

    private long checklistItemCount(Long taskId) {
        return jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM checklist_item WHERE task_id = ?", Long.class, taskId);
    }

    private String assertFieldValidation(MvcResult result, String field) throws Exception {
        assertThat(result.getResponse().getStatus()).isEqualTo(400);
        String body = result.getResponse().getContentAsString();
        assertThat(JsonPath.parse(body).read("$.title", String.class))
                .isEqualTo("Validation Failed");
        String message = JsonPath.parse(body).read("$.errors." + field, String.class);
        assertThat(message).isNotBlank();
        return message;
    }
}
