package com.krishnamurti.horizon.note.infrastructure;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.krishnamurti.horizon.HorizonApplication;
import com.krishnamurti.horizon.TestcontainersConfiguration;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;

@SpringBootTest(
        classes = HorizonApplication.class,
        properties = "spring.jpa.hibernate.ddl-auto=validate")
@Import(TestcontainersConfiguration.class)
class NoteTagAssociationRepositoryIntegrationTest {

    @Autowired private NoteTagAssociationRepository associationRepository;
    @Autowired private JdbcTemplate jdbcTemplate;

    @Test
    void migrationCreatesCompositeKeyForeignKeysAndReverseLookupIndex() {
        assertThat(constraintExists("pk_note_tag")).isTrue();
        assertThat(constraintExists("fk_note_tag_note")).isTrue();
        assertThat(constraintExists("fk_note_tag_tag")).isTrue();
        assertThat(indexExists("idx_note_tag_tag_id")).isTrue();
    }

    @Test
    void associationReadsAndReplacementAreNoteOwnerScopedAndKeepUnassignedTags() {
        Long ownerId = createUserId();
        Long otherOwnerId = createUserId();
        Long ownerNoteId = insertNote(ownerId);
        Long otherNoteId = insertNote(otherOwnerId);
        Long ownerTagId = insertTag(ownerId, "Horizon");
        Long otherTagId = insertTag(otherOwnerId, "Private");

        associationRepository.replace(ownerId, ownerNoteId, Set.of(ownerTagId));
        associationRepository.replace(ownerId, otherNoteId, Set.of(otherTagId));

        assertThat(associationRepository.findTagIdsForNote(ownerId, ownerNoteId))
                .containsExactly(ownerTagId);
        assertThat(associationRepository.findTagIdsForNote(ownerId, otherNoteId)).isEmpty();
        assertThat(
                        associationRepository.findTagIdsByNoteIds(
                                ownerId, Set.of(ownerNoteId, otherNoteId, Long.MAX_VALUE)))
                .containsOnlyKeys(ownerNoteId)
                .containsEntry(ownerNoteId, List.of(ownerTagId));

        associationRepository.replace(otherOwnerId, otherNoteId, Set.of(otherTagId));
        associationRepository.replace(ownerId, ownerNoteId, Set.of());

        assertThat(associationRepository.findTagIdsForNote(ownerId, ownerNoteId)).isEmpty();
        assertThat(tagExists(ownerTagId)).isTrue();
        assertThat(associationRepository.findTagIdsByNoteIds(ownerId, Set.of())).isEmpty();
    }

    @Test
    void databaseRejectsDuplicateLinksAndUnknownNoteOrTagIds() {
        Long ownerId = createUserId();
        Long noteId = insertNote(ownerId);
        Long tagId = insertTag(ownerId, "Horizon");
        jdbcTemplate.update("INSERT INTO note_tag (note_id, tag_id) VALUES (?, ?)", noteId, tagId);

        assertThatThrownBy(
                        () ->
                                jdbcTemplate.update(
                                        "INSERT INTO note_tag (note_id, tag_id) VALUES (?, ?)",
                                        noteId,
                                        tagId))
                .isInstanceOf(DataIntegrityViolationException.class);
        assertThatThrownBy(
                        () ->
                                jdbcTemplate.update(
                                        "INSERT INTO note_tag (note_id, tag_id) VALUES (?, ?)",
                                        Long.MAX_VALUE,
                                        tagId))
                .isInstanceOf(DataIntegrityViolationException.class);
        assertThatThrownBy(
                        () ->
                                jdbcTemplate.update(
                                        "INSERT INTO note_tag (note_id, tag_id) VALUES (?, ?)",
                                        noteId,
                                        Long.MAX_VALUE))
                .isInstanceOf(DataIntegrityViolationException.class);
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

    private boolean constraintExists(String name) {
        return Boolean.TRUE.equals(
                jdbcTemplate.queryForObject(
                        "SELECT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = ?)",
                        Boolean.class,
                        name));
    }

    private boolean indexExists(String name) {
        return Boolean.TRUE.equals(
                jdbcTemplate.queryForObject(
                        "SELECT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = ?)",
                        Boolean.class,
                        name));
    }

    private boolean tagExists(Long tagId) {
        return Boolean.TRUE.equals(
                jdbcTemplate.queryForObject(
                        "SELECT EXISTS (SELECT 1 FROM tag WHERE id = ?)", Boolean.class, tagId));
    }
}
