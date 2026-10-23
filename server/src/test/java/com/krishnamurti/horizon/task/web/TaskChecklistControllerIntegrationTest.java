package com.krishnamurti.horizon.task.web;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
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
class TaskChecklistControllerIntegrationTest {

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
