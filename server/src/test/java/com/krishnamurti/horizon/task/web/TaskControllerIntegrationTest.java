package com.krishnamurti.horizon.task.web;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.not;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
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
    void optionalFieldsRoundTripInDetail() throws Exception {
        mockMvc.perform(
                        post("/api/v1/tasks")
                                .cookie(ownerCookie)
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        "{\"title\":\"Write"
                                            + " docs\",\"description\":{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\",\"content\":[{\"text\":\"Nested\"}]}]},\"priority\":\"HIGH\",\"dueDate\":\"2026-10-20\"}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.description.type").value("doc"))
                .andExpect(jsonPath("$.description.content[0].content[0].text").value("Nested"))
                .andExpect(jsonPath("$.priority").value("HIGH"))
                .andExpect(jsonPath("$.dueDate").value("2026-10-20"));
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
}
