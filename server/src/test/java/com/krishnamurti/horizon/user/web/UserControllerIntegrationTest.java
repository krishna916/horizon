package com.krishnamurti.horizon.user.web;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.krishnamurti.horizon.HorizonApplication;
import com.krishnamurti.horizon.TestcontainersConfiguration;
import com.krishnamurti.horizon.user.application.UserCommandService;
import jakarta.servlet.http.Cookie;
import java.util.Map;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import tools.jackson.databind.json.JsonMapper;

@SpringBootTest(classes = HorizonApplication.class)
@ActiveProfiles("test")
@AutoConfigureMockMvc
@Import(TestcontainersConfiguration.class)
class UserControllerIntegrationTest {

    @Autowired private MockMvc mockMvc;

    @Autowired private JsonMapper objectMapper;

    @Autowired private UserCommandService userCommandService;

    private static final String TEST_EMAIL = "user-test@example.com";
    private static final String TEST_PASSWORD = "Password123!";

    private Cookie sessionCookie;

    @BeforeAll
    static void setTestTimeZone() {
        java.util.TimeZone.setDefault(java.util.TimeZone.getTimeZone("UTC"));
    }

    @BeforeEach
    void setUpUserAndSession() throws Exception {
        try {
            userCommandService.register(TEST_EMAIL, TEST_PASSWORD);
        } catch (Exception e) {
            // User might already be registered across test runs
        }

        LoginRequest loginRequest = new LoginRequest(TEST_EMAIL, TEST_PASSWORD);
        MvcResult result =
                mockMvc.perform(
                                post("/api/v1/auth/login")
                                        .contentType(MediaType.APPLICATION_JSON)
                                        .content(objectMapper.writeValueAsString(loginRequest)))
                        .andExpect(status().isOk())
                        .andReturn();

        sessionCookie = result.getResponse().getCookie("SESSION");
        assertThat(sessionCookie).isNotNull();
    }

    // --- ME ENDPOINT TESTS ---

    @Test
    void shouldGetMeSuccessfully() throws Exception {
        mockMvc.perform(get("/api/v1/users/me").cookie(sessionCookie))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").isNumber())
                .andExpect(jsonPath("$.email").value(TEST_EMAIL));
    }

    @Test
    void shouldRejectUnauthenticatedGetMe() throws Exception {
        mockMvc.perform(get("/api/v1/users/me")).andExpect(status().isUnauthorized());
    }

    // --- SETTINGS ENDPOINT TESTS ---

    @Test
    void shouldGetDefaultSettings() throws Exception {
        mockMvc.perform(get("/api/v1/users/me/settings").cookie(sessionCookie))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.theme").value("SYSTEM"));
    }

    @Test
    void shouldUpdateSettings() throws Exception {
        UpdateUserSettingsRequest updateRequest = new UpdateUserSettingsRequest("DARK");

        mockMvc.perform(
                        patch("/api/v1/users/me/settings")
                                .cookie(sessionCookie)
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(objectMapper.writeValueAsString(updateRequest)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.theme").value("DARK"));

        // Verify updated setting is returned on subsequent GET
        mockMvc.perform(get("/api/v1/users/me/settings").cookie(sessionCookie))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.theme").value("DARK"));
    }

    @Test
    void shouldRejectInvalidTheme() throws Exception {
        UpdateUserSettingsRequest invalidRequest = new UpdateUserSettingsRequest("INVALID_THEME");

        mockMvc.perform(
                        patch("/api/v1/users/me/settings")
                                .cookie(sessionCookie)
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(objectMapper.writeValueAsString(invalidRequest)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.title").value("Validation Failed"));
    }

    @Test
    void shouldRejectNullTheme() throws Exception {
        Map<String, Object> invalidRequest = Map.of();

        mockMvc.perform(
                        patch("/api/v1/users/me/settings")
                                .cookie(sessionCookie)
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(objectMapper.writeValueAsString(invalidRequest)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.title").value("Validation Failed"));
    }

    @Test
    void shouldRejectUnauthenticatedGetSettings() throws Exception {
        mockMvc.perform(get("/api/v1/users/me/settings")).andExpect(status().isUnauthorized());
    }

    @Test
    void shouldRejectUnauthenticatedPatchSettings() throws Exception {
        UpdateUserSettingsRequest updateRequest = new UpdateUserSettingsRequest("LIGHT");
        mockMvc.perform(
                        patch("/api/v1/users/me/settings")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(objectMapper.writeValueAsString(updateRequest)))
                .andExpect(status().isUnauthorized());
    }
}
