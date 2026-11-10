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
import com.krishnamurti.horizon.note.domain.Note;
import com.krishnamurti.horizon.note.domain.NoteContentPolicy;
import com.krishnamurti.horizon.note.infrastructure.NoteRepository;
import com.krishnamurti.horizon.user.application.UserCommandService;
import jakarta.servlet.http.Cookie;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
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
class NoteControllerIntegrationTest {

    private static final String PASSWORD = "Password123!";
    @Autowired private MockMvc mockMvc;
    @Autowired private UserCommandService userCommandService;
    @Autowired private NoteRepository noteRepository;
    @Autowired private JdbcTemplate jdbcTemplate;
    private Cookie ownerCookie;
    private Long ownerId;

    @BeforeEach
    void setUpUserAndSession() throws Exception {
        String email = UUID.randomUUID() + "@example.com";
        ownerId = userCommandService.register(email, PASSWORD).id();
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
                        .andExpect(jsonPath("$.deletedAt").doesNotExist())
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
                .andExpect(jsonPath("$.deletedAt").doesNotExist())
                .andExpect(jsonPath("$.archivedAt").doesNotExist())
                .andExpect(jsonPath("$.createdAt").exists())
                .andExpect(jsonPath("$.updatedAt").exists())
                .andExpect(jsonPath("$.content.content[0].content[0].text").value("A note body"));
    }

    @Test
    void tagOnlyAndNullTagCreatesAreRejectedWithoutWrites() throws Exception {
        mockMvc.perform(
                        post("/api/v1/notes")
                                .cookie(ownerCookie)
                                .header("Idempotency-Key", UUID.randomUUID().toString())
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"tags\":[{\"name\":\"Staged\"}]}"))
                .andExpect(status().isBadRequest());
        mockMvc.perform(
                        post("/api/v1/notes")
                                .cookie(ownerCookie)
                                .header("Idempotency-Key", UUID.randomUUID().toString())
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"title\":\"Note\",\"tags\":null}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.errors.tags").exists());

        assertThat(
                        jdbcTemplate.queryForObject(
                                "SELECT COUNT(*) FROM note WHERE user_id = ?", Long.class, ownerId))
                .isZero();
        assertThat(
                        jdbcTemplate.queryForObject(
                                "SELECT COUNT(*) FROM tag WHERE user_id = ?", Long.class, ownerId))
                .isZero();
        assertThat(
                        jdbcTemplate.queryForObject(
                                "SELECT COUNT(*) FROM note_creation_request WHERE user_id = ?",
                                Long.class,
                                ownerId))
                .isZero();
    }

    @Test
    void createTagsAreCanonicalAndRetryFingerprintIgnoresOrderCaseAndDuplicates() throws Exception {
        String key = UUID.randomUUID().toString();
        MvcResult created =
                mockMvc.perform(
                                post("/api/v1/notes")
                                        .cookie(ownerCookie)
                                        .header("Idempotency-Key", key)
                                        .contentType(MediaType.APPLICATION_JSON)
                                        .content(
                                                "{\"title\":\"Tagged\",\"tags\":[{\"name\":\" Work "
                                                        + "\"},{\"name\":\"work\"}]}"))
                        .andExpect(status().isCreated())
                        .andExpect(jsonPath("$.tags.length()").value(1))
                        .andExpect(jsonPath("$.tags[0].name").value("Work"))
                        .andReturn();
        Number id = JsonPath.read(created.getResponse().getContentAsString(), "$.id");
        Number tagId = JsonPath.read(created.getResponse().getContentAsString(), "$.tags[0].id");

        MvcResult replay =
                mockMvc.perform(
                                post("/api/v1/notes")
                                        .cookie(ownerCookie)
                                        .header("Idempotency-Key", key)
                                        .contentType(MediaType.APPLICATION_JSON)
                                        .content(
                                                "{\"title\":\"Tagged\",\"tags\":[{\"name\":\"WORK\"},{\"name\":\""
                                                    + " work \"}]}"))
                        .andExpect(status().isCreated())
                        .andExpect(jsonPath("$.tags[0].id").value(tagId.longValue()))
                        .andReturn();
        assertThat(
                        JsonPath.<Number>read(replay.getResponse().getContentAsString(), "$.id")
                                .longValue())
                .isEqualTo(id.longValue());

        mockMvc.perform(
                        post("/api/v1/notes")
                                .cookie(ownerCookie)
                                .header("Idempotency-Key", key)
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        "{\"title\":\"Tagged\",\"tags\":[{\"id\":"
                                                + tagId.longValue()
                                                + "}]}"))
                .andExpect(status().isConflict());
    }

    @Test
    void patchUsesExpectedVersionAndRejectsUnknownFields() throws Exception {
        long id = createNote("{\"title\":\"Before\"}");
        mockMvc.perform(
                        patch("/api/v1/notes/{id}", id)
                                .cookie(ownerCookie)
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        "{\"expectedVersion\":0,\"title\":\"\\u00a0Before\\u00a0\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.title").value("Before"))
                .andExpect(jsonPath("$.version").value(0))
                .andExpect(jsonPath("$.deletedAt").doesNotExist());
        mockMvc.perform(
                        patch("/api/v1/notes/{id}", id)
                                .cookie(ownerCookie)
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"expectedVersion\":0,\"title\":null}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.title").value(org.hamcrest.Matchers.nullValue()))
                .andExpect(jsonPath("$.version").value(1))
                .andExpect(jsonPath("$.deletedAt").doesNotExist())
                .andExpect(jsonPath("$.createdAt").exists())
                .andExpect(jsonPath("$.updatedAt").exists());
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
    void limitsRawNoteBodiesBeforeParsingAndKeepsSemanticContentLimit() throws Exception {
        String oversizedText = "x".repeat((int) NoteRequestBodyLimitAdvice.MAX_REQUEST_BYTES + 1);
        String oversizedBody = noteBody("Large", oversizedText);

        mockMvc.perform(
                        post("/api/v1/notes")
                                .cookie(ownerCookie)
                                .header("Idempotency-Key", UUID.randomUUID().toString())
                                .header(
                                        "Content-Length",
                                        NoteRequestBodyLimitAdvice.MAX_REQUEST_BYTES + 1)
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{}"))
                .andExpect(status().isPayloadTooLarge())
                .andExpect(jsonPath("$.status").value(413))
                .andExpect(jsonPath("$.title").value("Note Request Too Large"));

        mockMvc.perform(
                        post("/api/v1/notes")
                                .cookie(ownerCookie)
                                .header("Idempotency-Key", UUID.randomUUID().toString())
                                .header("Transfer-Encoding", "chunked")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(oversizedBody))
                .andExpect(status().isPayloadTooLarge())
                .andExpect(jsonPath("$.status").value(413));

        long id =
                createNote(
                        "{\"title\":\"Before\",\"content\":{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"text\":\"unchanged\"}]}]}}");
        mockMvc.perform(
                        patch("/api/v1/notes/{id}", id)
                                .cookie(ownerCookie)
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        "{\"expectedVersion\":0,\"content\":{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"text\":\""
                                                + oversizedText
                                                + "\"}]}]}}"))
                .andExpect(status().isPayloadTooLarge())
                .andExpect(jsonPath("$.status").value(413));
        mockMvc.perform(get("/api/v1/notes/{id}", id).cookie(ownerCookie))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content.content[0].content[0].text").value("unchanged"));

        mockMvc.perform(
                        post("/api/v1/notes")
                                .cookie(ownerCookie)
                                .header("Idempotency-Key", UUID.randomUUID().toString())
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{}"))
                .andExpect(status().isBadRequest());
        mockMvc.perform(
                        post("/api/v1/notes")
                                .cookie(ownerCookie)
                                .header("Idempotency-Key", UUID.randomUUID().toString())
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(noteBody("Large but semantic", "x".repeat(1_048_577))))
                .andExpect(status().isBadRequest());
        mockMvc.perform(
                        post("/api/v1/notes")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(oversizedBody))
                .andExpect(status().isUnauthorized());
    }

    private static String noteBody(String title, String text) {
        return "{\"title\":\""
                + title
                + "\",\"content\":{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"text\":\""
                + text
                + "\"}]}]}}";
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

    @Test
    void largeCollectionPageReturnsOnlyThirtyBoundedPreviewsAndFullDetailRemainsAvailable()
            throws Exception {
        String fullText = "large note body ".repeat(8_192);
        Map<String, Object> document =
                Map.of(
                        "type",
                        "doc",
                        "content",
                        List.of(
                                Map.of(
                                        "type",
                                        "paragraph",
                                        "content",
                                        List.of(Map.of("type", "text", "text", fullText)))));
        List<Note> notes = new ArrayList<>();
        for (int index = 0; index < 105; index++) {
            notes.add(Note.create(ownerId, "Large " + index, document));
        }
        noteRepository.saveAllAndFlush(notes);

        MvcResult listed =
                mockMvc.perform(get("/api/v1/notes").cookie(ownerCookie))
                        .andExpect(status().isOk())
                        .andExpect(jsonPath("$.items.length()").value(30))
                        .andExpect(jsonPath("$.page").value(0))
                        .andExpect(jsonPath("$.size").value(30))
                        .andExpect(jsonPath("$.hasNext").value(true))
                        .andExpect(jsonPath("$.counts.active").value(105))
                        .andReturn();
        String listJson = listed.getResponse().getContentAsString();
        assertThat(listJson).doesNotContain(fullText);
        assertThat(listJson.getBytes(java.nio.charset.StandardCharsets.UTF_8).length)
                .isLessThan(30 * 16 * 1024);
        List<Map<String, Object>> previews = JsonPath.read(listJson, "$.items[*].preview");
        assertThat(previews).hasSize(30);
        for (Map<String, Object> preview : previews) {
            assertThat(NoteContentPolicy.validateAndCopy(preview)).isEqualTo(preview);
            assertThat(previewText(preview).length()).isLessThanOrEqualTo(520);
            assertThat(
                            new com.fasterxml.jackson.databind.ObjectMapper()
                                    .writeValueAsBytes(preview)
                                    .length)
                    .isLessThanOrEqualTo(16 * 1024);
        }
        Number noteId = JsonPath.read(listJson, "$.items[0].id");
        mockMvc.perform(get("/api/v1/notes/{id}", noteId.longValue()).cookie(ownerCookie))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content.content[0].content[0].text").value(fullText));
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

    private static String previewText(Object node) {
        StringBuilder text = new StringBuilder();
        appendPreviewText(node, text);
        return text.toString();
    }

    private static void appendPreviewText(Object node, StringBuilder text) {
        if (node instanceof Map<?, ?> map) {
            if ("text".equals(map.get("type"))) text.append(map.get("text"));
            Object children = map.get("content");
            if (children instanceof List<?> list)
                list.forEach(child -> appendPreviewText(child, text));
        }
    }
}
