package com.krishnamurti.horizon.task.web;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import com.krishnamurti.horizon.TestcontainersConfiguration;
import com.krishnamurti.horizon.user.application.UserCommandService;
import jakarta.servlet.http.Cookie;
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

@SpringBootTest(properties = "spring.jpa.hibernate.ddl-auto=validate")
@AutoConfigureMockMvc
@Import(TestcontainersConfiguration.class)
class TaskCreationConcurrencyIntegrationTest {

    private static final String PASSWORD = "Password123!";

    @Autowired private MockMvc mockMvc;
    @Autowired private UserCommandService userCommandService;
    @Autowired private JdbcTemplate jdbcTemplate;

    private Cookie ownerCookie;
    private Long ownerId;

    @BeforeEach
    void setUpAuthenticatedOwner() throws Exception {
        String email = UUID.randomUUID() + "@example.com";
        ownerId = userCommandService.register(email, PASSWORD).id();
        MvcResult login =
                mockMvc.perform(
                                post("/api/v1/auth/login")
                                        .contentType(MediaType.APPLICATION_JSON)
                                        .content(
                                                "{\"email\":\""
                                                        + email
                                                        + "\",\"password\":\""
                                                        + PASSWORD
                                                        + "\"}"))
                        .andReturn();
        assertThat(login.getResponse().getStatus()).isEqualTo(200);
        ownerCookie = login.getResponse().getCookie("SESSION");
        assertThat(ownerCookie).isNotNull();
    }

    @Test
    void concurrentSameKeyRequestsCreateOneTaskAndReturnSameIdentity() throws Exception {
        String requestKey = UUID.randomUUID().toString();
        String body = "{\"title\":\"Concurrent task\"}";
        CountDownLatch ready = new CountDownLatch(2);
        CountDownLatch start = new CountDownLatch(1);
        ExecutorService executor = Executors.newFixedThreadPool(2);

        try {
            Future<MvcResult> first =
                    executor.submit(() -> postAfterStart(requestKey, body, ready, start));
            Future<MvcResult> second =
                    executor.submit(() -> postAfterStart(requestKey, body, ready, start));

            assertThat(ready.await(5, TimeUnit.SECONDS)).isTrue();
            start.countDown();
            MvcResult firstResponse = first.get(15, TimeUnit.SECONDS);
            MvcResult secondResponse = second.get(15, TimeUnit.SECONDS);

            assertThat(firstResponse.getResponse().getStatus()).isEqualTo(201);
            assertThat(secondResponse.getResponse().getStatus()).isEqualTo(201);
            Long firstId = readTaskId(firstResponse);
            Long secondId = readTaskId(secondResponse);
            assertThat(secondId).isEqualTo(firstId);
            assertThat(firstResponse.getResponse().getHeader("Location"))
                    .isEqualTo(secondResponse.getResponse().getHeader("Location"));
            assertThat(taskCount()).isEqualTo(1L);
            assertThat(counterValue()).isEqualTo(1L);
        } finally {
            start.countDown();
            executor.shutdownNow();
        }
    }

    private MvcResult postAfterStart(
            String requestKey, String body, CountDownLatch ready, CountDownLatch start)
            throws Exception {
        ready.countDown();
        if (!start.await(5, TimeUnit.SECONDS)) {
            throw new AssertionError("Concurrent task creation start signal timed out.");
        }
        return mockMvc.perform(
                        post("/api/v1/tasks")
                                .cookie(ownerCookie)
                                .header("Idempotency-Key", requestKey)
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(body))
                .andReturn();
    }

    private Long readTaskId(MvcResult result) throws Exception {
        return com.jayway.jsonpath.JsonPath.parse(result.getResponse().getContentAsString())
                .read("$.id", Long.class);
    }

    private Long taskCount() {
        return jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM task WHERE user_id = ?", Long.class, ownerId);
    }

    private Long counterValue() {
        return jdbcTemplate.queryForObject(
                "SELECT last_allocated FROM task_key_counter WHERE user_id = ?",
                Long.class,
                ownerId);
    }
}
