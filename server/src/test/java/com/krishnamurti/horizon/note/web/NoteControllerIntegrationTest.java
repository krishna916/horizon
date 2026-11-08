package com.krishnamurti.horizon.note.web;

import static org.assertj.core.api.Assertions.assertThat;
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
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

@SpringBootTest(properties = "spring.jpa.hibernate.ddl-auto=validate")
@AutoConfigureMockMvc
@Import(TestcontainersConfiguration.class)
class NoteControllerIntegrationTest {

    private static final String PASSWORD = "Password123!";
    @Autowired private MockMvc mockMvc;
    @Autowired private UserCommandService userCommandService;
    private Cookie ownerCookie;

    @BeforeEach
    void setUpUserAndSession() throws Exception {
        String email = UUID.randomUUID() + "@example.com";
        userCommandService.register(email, PASSWORD);
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
        ownerCookie = result.getResponse().getCookie("SESSION");
        assertThat(ownerCookie).isNotNull();
    }

    @Test
    void requiresAuthenticationAndCanonicalIdempotencyKey() throws Exception {
        mockMvc.perform(get("/api/v1/notes")).andExpect(status().isUnauthorized());
        mockMvc.perform(
                        post("/api/v1/notes")
                                .cookie(ownerCookie)
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"title\":\"hello\"}"))
                .andExpect(status().isBadRequest());
        mockMvc.perform(
                        post("/api/v1/notes")
                                .cookie(ownerCookie)
                                .header("Idempotency-Key", "not-a-uuid")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"title\":\"hello\"}"))
                .andExpect(status().isBadRequest());
    }

    @Test
    void createReplaysIdempotentlyAndListUsesBoundedPreviewWhileDetailReturnsContent()
            throws Exception {
        String key = UUID.randomUUID().toString();
        String body =
                "{\"title\":null,\"content\":{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"text\":\"A"
                    + " note body\"}]}]}}";
        MvcResult created =
                mockMvc.perform(
                                post("/api/v1/notes")
                                        .cookie(ownerCookie)
                                        .header("Idempotency-Key", key)
                                        .contentType(MediaType.APPLICATION_JSON)
                                        .content(body))
                        .andExpect(status().isCreated())
                        .andExpect(
                                header().string(
                                                "Location",
                                                org.hamcrest.Matchers.containsString(
                                                        "/api/v1/notes/")))
                        .andExpect(jsonPath("$.title").value(org.hamcrest.Matchers.nullValue()))
                        .andExpect(jsonPath("$.inbox").value(false))
                        .andExpect(jsonPath("$.version").value(0))
                        .andReturn();
        Number createdId = JsonPath.read(created.getResponse().getContentAsString(), "$.id");
        long id = createdId.longValue();
        MvcResult replayed =
                mockMvc.perform(
                                post("/api/v1/notes")
                                        .cookie(ownerCookie)
                                        .header("Idempotency-Key", key)
                                        .contentType(MediaType.APPLICATION_JSON)
                                        .content(body))
                        .andExpect(status().isCreated())
                        .andReturn();
        Number replayedId = JsonPath.read(replayed.getResponse().getContentAsString(), "$.id");
        assertThat(replayedId.longValue()).isEqualTo(id);

        mockMvc.perform(get("/api/v1/notes").cookie(ownerCookie))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[0].preview.type").value("doc"))
                .andExpect(jsonPath("$.items[0].content").doesNotExist())
                .andExpect(jsonPath("$.counts.active").value(1));
        mockMvc.perform(get("/api/v1/notes/{id}", id).cookie(ownerCookie))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content.content[0].content[0].text").value("A note body"));
    }

    @Test
    void patchUsesExpectedVersionAndRejectsUnknownFields() throws Exception {
        long id = createNote("{\"title\":\"Before\"}");
        mockMvc.perform(
                        patch("/api/v1/notes/{id}", id)
                                .cookie(ownerCookie)
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"expectedVersion\":0,\"title\":null}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.title").value(org.hamcrest.Matchers.nullValue()))
                .andExpect(jsonPath("$.version").value(1));
        mockMvc.perform(
                        patch("/api/v1/notes/{id}", id)
                                .cookie(ownerCookie)
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"expectedVersion\":0}"))
                .andExpect(status().isConflict());
        mockMvc.perform(
                        patch("/api/v1/notes/{id}", id)
                                .cookie(ownerCookie)
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"expectedVersion\":1,\"inbox\":true}"))
                .andExpect(status().isBadRequest());
    }

    @Test
    void rejectsInvalidCreatePayloadsReplayConflictsAndBrowseParameters() throws Exception {
        String key = UUID.randomUUID().toString();
        mockMvc.perform(
                        post("/api/v1/notes")
                                .cookie(ownerCookie)
                                .header("Idempotency-Key", UUID.randomUUID().toString())
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.status").value(400));
        mockMvc.perform(
                        post("/api/v1/notes")
                                .cookie(ownerCookie)
                                .header("Idempotency-Key", UUID.randomUUID().toString())
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"title\":\"x\",\"inbox\":true}"))
                .andExpect(status().isBadRequest());

        createWithKey(key, "{\"title\":\"First\"}", 201);
        createWithKey(key, "{\"title\":\"Changed\"}", 409);
        mockMvc.perform(get("/api/v1/notes?page=-1").cookie(ownerCookie))
                .andExpect(status().isBadRequest());
        mockMvc.perform(get("/api/v1/notes?size=101").cookie(ownerCookie))
                .andExpect(status().isBadRequest());
        mockMvc.perform(get("/api/v1/notes?sort=title_desc").cookie(ownerCookie))
                .andExpect(status().isBadRequest());
        mockMvc.perform(get("/api/v1/notes?page=2147483647&size=100").cookie(ownerCookie))
                .andExpect(status().isBadRequest());
    }

    @Test
    void hidesForeignNotesFromDetailAndPatch() throws Exception {
        long id = createNote("{\"title\":\"Private\"}");
        String foreignEmail = UUID.randomUUID() + "@example.com";
        userCommandService.register(foreignEmail, PASSWORD);
        MvcResult result =
                mockMvc.perform(
                                post("/api/v1/auth/login")
                                        .contentType(MediaType.APPLICATION_JSON)
                                        .content(
                                                "{\"email\":\""
                                                        + foreignEmail
                                                        + "\",\"password\":\""
                                                        + PASSWORD
                                                        + "\"}"))
                        .andExpect(status().isOk())
                        .andReturn();
        Cookie foreignCookie = result.getResponse().getCookie("SESSION");
        mockMvc.perform(get("/api/v1/notes/{id}", id).cookie(foreignCookie))
                .andExpect(status().isNotFound());
        mockMvc.perform(
                        patch("/api/v1/notes/{id}", id)
                                .cookie(foreignCookie)
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"expectedVersion\":0,\"title\":\"Changed\"}"))
                .andExpect(status().isNotFound());
    }

    private long createNote(String body) throws Exception {
        MvcResult result =
                mockMvc.perform(
                                post("/api/v1/notes")
                                        .cookie(ownerCookie)
                                        .header("Idempotency-Key", UUID.randomUUID().toString())
                                        .contentType(MediaType.APPLICATION_JSON)
                                        .content(body))
                        .andExpect(status().isCreated())
                        .andReturn();
        Number id = JsonPath.read(result.getResponse().getContentAsString(), "$.id");
        return id.longValue();
    }

    private void createWithKey(String key, String body, int expectedStatus) throws Exception {
        mockMvc.perform(
                        post("/api/v1/notes")
                                .cookie(ownerCookie)
                                .header("Idempotency-Key", key)
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(body))
                .andExpect(status().is(expectedStatus));
    }
}
