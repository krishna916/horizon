package com.krishnamurti.horizon.user.web;

import tools.jackson.databind.json.JsonMapper;
import com.krishnamurti.horizon.HorizonApplication;
import com.krishnamurti.horizon.TestcontainersConfiguration;
import com.krishnamurti.horizon.user.application.UserCommandService;
import jakarta.servlet.http.Cookie;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest(classes = HorizonApplication.class)
@ActiveProfiles("test")
@AutoConfigureMockMvc
@Import(TestcontainersConfiguration.class)
class AuthControllerIntegrationTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private JsonMapper objectMapper;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @Autowired
    private UserCommandService userCommandService;

    private static final String TEST_EMAIL = "auth-test@example.com";
    private static final String TEST_PASSWORD = "Password123!";

    @BeforeAll
    static void setTestTimeZone() {
        java.util.TimeZone.setDefault(java.util.TimeZone.getTimeZone("UTC"));
    }

    @BeforeEach
    void setUpUser() {
        try {
            userCommandService.register(TEST_EMAIL, TEST_PASSWORD);
        } catch (Exception e) {
            // Ignore if already registered
        }
    }

    // --- REGISTRATION TESTS ---

    @Test
    void shouldRegisterUserSuccessfully() throws Exception {
        RegisterUserRequest request = new RegisterUserRequest("newuser-auth@example.com", "password123");

        mockMvc.perform(post("/api/v1/auth/register")
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(request)))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.id").isNumber())
            .andExpect(jsonPath("$.email").value("newuser-auth@example.com"));
    }

    @Test
    void shouldRejectDuplicateRegistration() throws Exception {
        RegisterUserRequest request = new RegisterUserRequest("duplicate-auth@example.com", "password123");

        mockMvc.perform(post("/api/v1/auth/register")
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(request)))
            .andExpect(status().isCreated());

        mockMvc.perform(post("/api/v1/auth/register")
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(request)))
            .andExpect(status().isConflict())
            .andExpect(jsonPath("$.title").value("Email Already Registered"));
    }

    @Test
    void shouldRejectMissingEmailOnRegistration() throws Exception {
        Map<String, String> request = Map.of("password", "password123");

        mockMvc.perform(post("/api/v1/auth/register")
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(request)))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.title").value("Validation Failed"));
    }

    @Test
    void shouldRejectInvalidEmailFormatOnRegistration() throws Exception {
        RegisterUserRequest request = new RegisterUserRequest("not-an-email", "password123");

        mockMvc.perform(post("/api/v1/auth/register")
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(request)))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.title").value("Validation Failed"));
    }

    @Test
    void shouldRejectShortPasswordOnRegistration() throws Exception {
        RegisterUserRequest request = new RegisterUserRequest("user-auth@example.com", "short");

        mockMvc.perform(post("/api/v1/auth/register")
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(request)))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.title").value("Validation Failed"));
    }

    @Test
    void shouldStoreHashedPassword() throws Exception {
        String email = "hashcheck-auth@example.com";
        RegisterUserRequest request = new RegisterUserRequest(email, "myPlainTextPassword");

        mockMvc.perform(post("/api/v1/auth/register")
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(request)))
            .andExpect(status().isCreated());

        String storedHash = jdbcTemplate.queryForObject(
            "SELECT password_hash FROM users WHERE email = ?", String.class, email);

        assertThat(storedHash)
            .isNotEqualTo("myPlainTextPassword")
            .startsWith("$2a$");
    }

    @Test
    void shouldNormalizeEmailToLowerCaseOnRegistration() throws Exception {
        RegisterUserRequest request = new RegisterUserRequest("MixedCaseAuth@Example.COM", "password123");

        mockMvc.perform(post("/api/v1/auth/register")
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(request)))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.email").value("mixedcaseauth@example.com"));
    }

    // --- LOGIN TESTS ---

    @Test
    void shouldLoginSuccessfully() throws Exception {
        LoginRequest request = new LoginRequest(TEST_EMAIL, TEST_PASSWORD);

        mockMvc.perform(post("/api/v1/auth/login")
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(request)))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.id").isNumber())
            .andExpect(jsonPath("$.email").value(TEST_EMAIL));
    }

    @Test
    void shouldRejectInvalidCredentials() throws Exception {
        LoginRequest request = new LoginRequest(TEST_EMAIL, "WrongPassword!");

        mockMvc.perform(post("/api/v1/auth/login")
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(request)))
            .andExpect(status().isUnauthorized())
            .andExpect(jsonPath("$.title").value("Invalid Credentials"))
            .andExpect(jsonPath("$.detail").value("The email address or password provided is incorrect."));
    }

    @Test
    void shouldNormalizeEmailOnLogin() throws Exception {
        LoginRequest request = new LoginRequest("AUTH-test@Example.COM", TEST_PASSWORD);

        mockMvc.perform(post("/api/v1/auth/login")
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(request)))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.email").value(TEST_EMAIL));
    }

    @Test
    void shouldPreventSessionFixation() throws Exception {
        Cookie initialCookie = new Cookie("SESSION", "ZWI1NmFhOTQtNjMxYS00NTA3LTlhYTAtYTM0OTVjZmM2ZDIz");
        LoginRequest request = new LoginRequest(TEST_EMAIL, TEST_PASSWORD);

        MvcResult result = mockMvc.perform(post("/api/v1/auth/login")
                .cookie(initialCookie)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(request)))
            .andExpect(status().isOk())
            .andReturn();

        Cookie newCookie = result.getResponse().getCookie("SESSION");
        assertThat(newCookie).isNotNull();
        assertThat(newCookie.getValue()).isNotEqualTo(initialCookie.getValue());
    }

    @Test
    void shouldAccessProtectedEndpointAfterLogin() throws Exception {
        LoginRequest request = new LoginRequest(TEST_EMAIL, TEST_PASSWORD);

        MvcResult result = mockMvc.perform(post("/api/v1/auth/login")
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(request)))
            .andExpect(status().isOk())
            .andReturn();

        Cookie sessionCookie = result.getResponse().getCookie("SESSION");
        assertThat(sessionCookie).isNotNull();

        // Calling /api/v1/users/me with the valid session cookie should pass Spring Security and return 200 OK.
        mockMvc.perform(get("/api/v1/users/me").cookie(sessionCookie))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.id").isNumber())
            .andExpect(jsonPath("$.email").value(TEST_EMAIL));
    }

    // --- LOGOUT TESTS ---

    @Test
    void shouldLogoutSuccessfullyAndBlockProtectedEndpoints() throws Exception {
        // 1. Login to obtain session
        LoginRequest loginRequest = new LoginRequest(TEST_EMAIL, TEST_PASSWORD);
        MvcResult loginResult = mockMvc.perform(post("/api/v1/auth/login")
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(loginRequest)))
            .andExpect(status().isOk())
            .andReturn();

        Cookie sessionCookie = loginResult.getResponse().getCookie("SESSION");
        assertThat(sessionCookie).isNotNull();

        // Verify access to /me works
        mockMvc.perform(get("/api/v1/users/me").cookie(sessionCookie))
            .andExpect(status().isOk());

        // 2. Perform logout
        mockMvc.perform(post("/api/v1/auth/logout").cookie(sessionCookie))
            .andExpect(status().isNoContent());

        // 3. Verify access to /me is now blocked
        mockMvc.perform(get("/api/v1/users/me").cookie(sessionCookie))
            .andExpect(status().isUnauthorized());
    }

    @Test
    void shouldRejectLogoutWhenNotAuthenticated() throws Exception {
        mockMvc.perform(post("/api/v1/auth/logout"))
            .andExpect(status().isUnauthorized());
    }
}
