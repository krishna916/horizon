package com.krishnamurti.horizon.note.web;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import com.jayway.jsonpath.JsonPath;
import com.krishnamurti.horizon.TestcontainersConfiguration;
import com.krishnamurti.horizon.user.application.UserCommandService;
import jakarta.servlet.http.Cookie;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
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
class NoteCreationConcurrencyIntegrationTest {

    @Autowired private MockMvc mockMvc;
    @Autowired private UserCommandService userCommandService;
    @Autowired private JdbcTemplate jdbcTemplate;

    @Test
    void concurrentHttpRetriesWithTheSameKeyCreateOneNote() throws Exception {
        String email = UUID.randomUUID() + "@example.com";
        Long ownerId = userCommandService.register(email, "Password123!").id();
        MvcResult login =
                mockMvc.perform(
                                post("/api/v1/auth/login")
                                        .contentType(MediaType.APPLICATION_JSON)
                                        .content(
                                                "{\"email\":\""
                                                        + email
                                                        + "\",\"password\":\"Password123!\"}"))
                        .andReturn();
        Cookie session = login.getResponse().getCookie("SESSION");
        String key = UUID.randomUUID().toString();
        String body = "{\"title\":\"Concurrent HTTP Note\",\"tags\":[{\"name\":\"Concurrent\"}]}";

        try (var executor = Executors.newFixedThreadPool(8)) {
            List<Callable<MvcResult>> requests = new ArrayList<>();
            for (int index = 0; index < 12; index++) {
                requests.add(
                        () ->
                                mockMvc.perform(
                                                post("/api/v1/notes")
                                                        .cookie(session)
                                                        .header("Idempotency-Key", key)
                                                        .contentType(MediaType.APPLICATION_JSON)
                                                        .content(body))
                                        .andReturn());
            }
            var responses = executor.invokeAll(requests);
            List<Long> ids = new ArrayList<>();
            for (var response : responses) {
                MvcResult result = response.get(10, TimeUnit.SECONDS);
                assertThat(result.getResponse().getStatus()).isEqualTo(201);
                Number id = JsonPath.read(result.getResponse().getContentAsString(), "$.id");
                ids.add(id.longValue());
            }
            assertThat(ids).doesNotContainNull().allMatch(id -> id.equals(ids.getFirst()));
        }
        assertThat(
                        jdbcTemplate.queryForObject(
                                "SELECT COUNT(*) FROM note WHERE user_id = ?", Long.class, ownerId))
                .isEqualTo(1L);
        assertThat(
                        jdbcTemplate.queryForObject(
                                "SELECT COUNT(*) FROM tag WHERE user_id = ? AND name ="
                                        + " 'Concurrent'",
                                Long.class,
                                ownerId))
                .isEqualTo(1L);
        assertThat(
                        jdbcTemplate.queryForObject(
                                "SELECT COUNT(*) FROM note_tag JOIN note ON note.id ="
                                        + " note_tag.note_id WHERE note.user_id = ?",
                                Long.class,
                                ownerId))
                .isEqualTo(1L);
    }
}
