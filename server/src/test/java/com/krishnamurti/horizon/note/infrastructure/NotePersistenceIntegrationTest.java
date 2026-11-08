package com.krishnamurti.horizon.note.infrastructure;

import static org.assertj.core.api.Assertions.assertThat;

import com.krishnamurti.horizon.TestcontainersConfiguration;
import com.krishnamurti.horizon.note.domain.Note;
import com.krishnamurti.horizon.user.application.UserCommandService;
import jakarta.persistence.EntityManager;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;

@SpringBootTest(properties = "spring.jpa.hibernate.ddl-auto=validate")
@Import(TestcontainersConfiguration.class)
class NotePersistenceIntegrationTest {

    @Autowired private JdbcTemplate jdbcTemplate;
    @Autowired private UserCommandService userCommandService;
    @Autowired private NoteRepository noteRepository;
    @Autowired private EntityManager entityManager;

    @Test
    void migrationCreatesNoteAndCreationRequestTables() {
        assertThat(tableExists("note")).isTrue();
        assertThat(tableExists("note_creation_request")).isTrue();
        assertThat(columnType("note", "id")).isEqualTo("bigint");
        assertThat(columnType("note", "title")).isEqualTo("character varying");
        assertThat(columnType("note", "content")).isEqualTo("jsonb");
        assertThat(columnType("note", "archived_at")).isEqualTo("timestamp with time zone");
        assertThat(columnType("note", "deleted_at")).isEqualTo("timestamp with time zone");
        assertThat(columnExists("note", "version")).isTrue();
        assertThat(columnExists("note", "inbox")).isTrue();
        assertThat(columnExists("note", "user_id")).isTrue();
        assertThat(columnExists("note", "created_at")).isTrue();
        assertThat(columnExists("note", "updated_at")).isTrue();
        assertThat(constraintExists("note", "fk_note_users")).isTrue();
        assertThat(indexExists("idx_note_user_lifecycle_updated")).isTrue();
        assertThat(constraintExists("note_creation_request", "pk_note_creation_request")).isTrue();
        assertThat(constraintExists("note_creation_request", "fk_note_creation_request_note"))
                .isTrue();
    }

    @Test
    void jsonbContentRoundTripsAndOwnerFinderScopesReads() {
        Long firstOwner = createUserId();
        Long secondOwner = createUserId();
        Map<String, Object> content =
                Map.of(
                        "type",
                        "doc",
                        "content",
                        List.of(
                                Map.of(
                                        "type",
                                        "paragraph",
                                        "content",
                                        List.of(Map.of("type", "text", "text", "A Note")))));
        Note saved = noteRepository.saveAndFlush(Note.create(firstOwner, null, content));
        entityManager.clear();

        Note reloaded =
                noteRepository
                        .findByIdAndUserIdAndDeletedAtIsNull(saved.getId(), firstOwner)
                        .orElseThrow();

        assertThat(reloaded.getContent()).isEqualTo(content);
        assertThat(reloaded.getTitle()).isNull();
        assertThat(reloaded.getVersion()).isZero();
        assertThat(reloaded.isInbox()).isFalse();
        assertThat(reloaded.getCreatedAt()).isNotNull();
        assertThat(reloaded.getUpdatedAt()).isNotNull();
        assertThat(noteRepository.findByIdAndUserIdAndDeletedAtIsNull(saved.getId(), secondOwner))
                .isEmpty();
    }

    private Long createUserId() {
        String suffix = UUID.randomUUID().toString();
        return userCommandService
                .register("note-owner-" + suffix + "@example.com", "StrongPassword123!")
                .id();
    }

    private boolean tableExists(String tableName) {
        return Boolean.TRUE.equals(
                jdbcTemplate.queryForObject(
                        "SELECT to_regclass(?) IS NOT NULL", Boolean.class, "public." + tableName));
    }

    private boolean columnExists(String tableName, String columnName) {
        return Boolean.TRUE.equals(
                jdbcTemplate.queryForObject(
                        "SELECT EXISTS (SELECT 1 FROM information_schema.columns"
                                + " WHERE table_schema = 'public' AND table_name = ?"
                                + " AND column_name = ?)",
                        Boolean.class,
                        tableName,
                        columnName));
    }

    private String columnType(String tableName, String columnName) {
        return jdbcTemplate.queryForObject(
                "SELECT data_type FROM information_schema.columns"
                        + " WHERE table_schema = 'public' AND table_name = ? AND column_name = ?",
                String.class,
                tableName,
                columnName);
    }

    private boolean constraintExists(String tableName, String constraintName) {
        return Boolean.TRUE.equals(
                jdbcTemplate.queryForObject(
                        "SELECT EXISTS (SELECT 1 FROM information_schema.table_constraints"
                                + " WHERE table_schema = 'public' AND table_name = ?"
                                + " AND constraint_name = ?)",
                        Boolean.class,
                        tableName,
                        constraintName));
    }

    private boolean indexExists(String indexName) {
        return Boolean.TRUE.equals(
                jdbcTemplate.queryForObject(
                        "SELECT EXISTS (SELECT 1 FROM pg_indexes"
                                + " WHERE schemaname = 'public' AND indexname = ?)",
                        Boolean.class,
                        indexName));
    }
}
