package com.krishnamurti.horizon.tag.web;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.krishnamurti.horizon.TestcontainersConfiguration;
import com.krishnamurti.horizon.user.application.UserCommandService;
import jakarta.servlet.http.Cookie;
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

@SpringBootTest
@AutoConfigureMockMvc
@Import(TestcontainersConfiguration.class)
class TagControllerIntegrationTest {

    private static final String PASSWORD = "Password123!";

    @Autowired private MockMvc mockMvc;
    @Autowired private UserCommandService userCommandService;
    @Autowired private JdbcTemplate jdbcTemplate;

    private String ownerEmail;
    private Long ownerId;
    private Cookie ownerCookie;

    @BeforeEach
    void setUpUserAndSession() throws Exception {
        ownerEmail = UUID.randomUUID() + "@example.com";
        ownerId = userCommandService.register(ownerEmail, PASSWORD).id();
        ownerCookie = login(ownerEmail);
    }

    @Test
    void rejectsUnauthenticatedSuggestions() throws Exception {
        mockMvc.perform(get("/api/v1/tags/suggestions").param("q", "h"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void suggestionsUseSessionOwnerAndIgnoreClientOwnerParameters() throws Exception {
        Long ownTagId = insertTag(ownerId, "Horizon");

        String otherEmail = UUID.randomUUID() + "@example.com";
        Long otherUserId = userCommandService.register(otherEmail, PASSWORD).id();
        Long otherTagId = insertTag(otherUserId, "Horizon Private");
        Cookie otherCookie = login(otherEmail);

        mockMvc.perform(
                        get("/api/v1/tags/suggestions")
                                .cookie(ownerCookie)
                                .param("q", "hor")
                                .param("userId", otherUserId.toString()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(1))
                .andExpect(jsonPath("$.items[0].id").value(ownTagId))
                .andExpect(jsonPath("$.items[0].name").value("Horizon"));

        mockMvc.perform(get("/api/v1/tags/suggestions").cookie(otherCookie).param("q", "hor"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(1))
                .andExpect(jsonPath("$.items[0].id").value(otherTagId))
                .andExpect(jsonPath("$.items[0].name").value("Horizon Private"));
    }

    @Test
    void requiresQueryParameterAndReturnsEmptyForPresentBlankValue() throws Exception {
        mockMvc.perform(get("/api/v1/tags/suggestions").cookie(ownerCookie))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.status").value(400))
                .andExpect(jsonPath("$.errors.q").isNotEmpty());

        mockMvc.perform(get("/api/v1/tags/suggestions").cookie(ownerCookie).param("q", ""))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items").isArray())
                .andExpect(jsonPath("$.items").isEmpty());

        mockMvc.perform(get("/api/v1/tags/suggestions").cookie(ownerCookie).param("q", "   "))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items").isEmpty());
    }

    @Test
    void rejectsControlsAndOverlongPrefixesButAcceptsOneHundredCodePoints() throws Exception {
        for (String prefix : new String[] {"\t", "Name\n", "😀".repeat(101)}) {
            mockMvc.perform(get("/api/v1/tags/suggestions").cookie(ownerCookie).param("q", prefix))
                    .andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.status").value(400))
                    .andExpect(jsonPath("$.errors.q").isNotEmpty());
        }

        mockMvc.perform(
                        get("/api/v1/tags/suggestions")
                                .cookie(ownerCookie)
                                .param("q", "😀".repeat(100)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items").isEmpty());
    }

    @Test
    void exposesNoStandaloneTagCreationOrIdLookupRoute() throws Exception {
        mockMvc.perform(
                        post("/api/v1/tags")
                                .cookie(ownerCookie)
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"name\":\"New\"}"))
                .andExpect(status().is4xxClientError());
        assertThat(
                        jdbcTemplate.queryForObject(
                                "SELECT count(*) FROM tag WHERE user_id = ?", Long.class, ownerId))
                .isZero();

        mockMvc.perform(get("/api/v1/tags/1").cookie(ownerCookie))
                .andExpect(status().is4xxClientError());
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

    private Long insertTag(Long userId, String name) {
        return jdbcTemplate.queryForObject(
                "INSERT INTO tag (user_id, name, created_at, updated_at) "
                        + "VALUES (?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) RETURNING id",
                Long.class,
                userId,
                name);
    }
}
