package com.krishnamurti.horizon.note.application;

import static org.assertj.core.api.Assertions.assertThat;

import com.krishnamurti.horizon.HorizonApplication;
import com.krishnamurti.horizon.TestcontainersConfiguration;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;

@SpringBootTest(
        classes = HorizonApplication.class,
        properties = "spring.jpa.hibernate.ddl-auto=validate")
@Import(TestcontainersConfiguration.class)
class NoteTagQueryServiceIntegrationTest {

    @Autowired private NoteTagQueryService queryService;
    @Autowired private JdbcTemplate jdbcTemplate;

    @Test
    void batchLoadsSortedTagsOnlyForOwnedNotesAndReturnsEmptyForNoIds() {
        Long ownerId = createUserId();
        Long otherOwnerId = createUserId();
        Long firstNoteId = insertNote(ownerId);
        Long secondNoteId = insertNote(ownerId);
        Long foreignNoteId = insertNote(otherOwnerId);
        Long zuluId = insertTag(ownerId, "zulu");
        Long alphaId = insertTag(ownerId, "Alpha");
        Long foreignId = insertTag(otherOwnerId, "Private");
        link(firstNoteId, zuluId);
        link(firstNoteId, alphaId);
        link(foreignNoteId, foreignId);

        assertThat(queryService.tagsForNotes(ownerId, Set.of())).isEmpty();
        assertThat(
                        queryService.tagsForNotes(
                                ownerId, List.of(firstNoteId, secondNoteId, foreignNoteId)))
                .containsOnlyKeys(firstNoteId, secondNoteId, foreignNoteId)
                .containsEntry(
                        firstNoteId,
                        List.of(
                                new com.krishnamurti.horizon.tag.api.TagReference(alphaId, "Alpha"),
                                new com.krishnamurti.horizon.tag.api.TagReference(zuluId, "zulu")))
                .containsEntry(secondNoteId, List.of())
                .containsEntry(foreignNoteId, List.of());
    }

    private Long createUserId() {
        return jdbcTemplate.queryForObject(
                "INSERT INTO users (email, password_hash, created_at, updated_at) VALUES (?,"
                        + " 'test-hash', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) RETURNING id",
                Long.class,
                UUID.randomUUID() + "@example.com");
    }

    private Long insertNote(Long userId) {
        return jdbcTemplate.queryForObject(
                "INSERT INTO note (user_id, inbox, created_at, updated_at) "
                        + "VALUES (?, FALSE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) RETURNING id",
                Long.class,
                userId);
    }

    private Long insertTag(Long userId, String name) {
        return jdbcTemplate.queryForObject(
                "INSERT INTO tag (user_id, name, created_at, updated_at) "
                        + "VALUES (?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) RETURNING id",
                Long.class,
                userId,
                name);
    }

    private void link(Long noteId, Long tagId) {
        jdbcTemplate.update("INSERT INTO note_tag (note_id, tag_id) VALUES (?, ?)", noteId, tagId);
    }
}
