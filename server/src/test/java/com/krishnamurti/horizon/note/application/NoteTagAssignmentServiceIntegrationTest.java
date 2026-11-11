package com.krishnamurti.horizon.note.application;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.krishnamurti.horizon.HorizonApplication;
import com.krishnamurti.horizon.TestcontainersConfiguration;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

@SpringBootTest(
        classes = HorizonApplication.class,
        properties = "spring.jpa.hibernate.ddl-auto=validate")
@Import(TestcontainersConfiguration.class)
class NoteTagAssignmentServiceIntegrationTest {

    @Autowired private NoteTagAssignmentService assignmentService;
    @Autowired private JdbcTemplate jdbcTemplate;
    @Autowired private PlatformTransactionManager transactionManager;

    @Test
    void reusesTaskTagsByIdAndNameAndDeduplicatesResolvedIdentities() {
        Long ownerId = createUserId();
        Long noteId = insertNote(ownerId);
        Long taskId = insertTask(ownerId);
        Long sharedTagId = insertTag(ownerId, "Work");
        jdbcTemplate.update(
                "INSERT INTO task_tag (task_id, tag_id) VALUES (?, ?)", taskId, sharedTagId);

        boolean changed =
                inWriteTransaction(
                        () ->
                                assignmentService.replace(
                                        ownerId,
                                        noteId,
                                        List.of(
                                                new NoteTagSelection(sharedTagId, null),
                                                new NoteTagSelection(null, "  work "),
                                                new NoteTagSelection(null, "Other"))));

        assertThat(changed).isTrue();
        assertThat(associationIds(ownerId, noteId))
                .containsExactlyInAnyOrder(sharedTagId, tagId(ownerId, "Other"));
        assertThat(tagExists(ownerId, "Other")).isTrue();
    }

    @Test
    void missingAndForeignTagIdsAreIndistinguishableAndDoNotChangeLinks() {
        Long ownerId = createUserId();
        Long otherOwnerId = createUserId();
        Long noteId = insertNote(ownerId);
        Long existingTagId = insertTag(ownerId, "Existing");
        Long foreignTagId = insertTag(otherOwnerId, "Private");
        inWriteTransaction(
                () ->
                        assignmentService.replace(
                                ownerId,
                                noteId,
                                List.of(new NoteTagSelection(existingTagId, null))));

        assertThatThrownBy(
                        () ->
                                inWriteTransaction(
                                        () ->
                                                assignmentService.replace(
                                                        ownerId,
                                                        noteId,
                                                        List.of(
                                                                new NoteTagSelection(
                                                                        foreignTagId, null)))))
                .isInstanceOf(InvalidNoteTagReferenceException.class);
        assertThatThrownBy(
                        () ->
                                inWriteTransaction(
                                        () ->
                                                assignmentService.replace(
                                                        ownerId,
                                                        noteId,
                                                        List.of(
                                                                new NoteTagSelection(
                                                                        Long.MAX_VALUE, null)))))
                .isInstanceOf(InvalidNoteTagReferenceException.class);

        assertThat(associationIds(ownerId, noteId)).containsExactly(existingTagId);
    }

    @Test
    void newlyResolvedTagRollsBackWhenAssociationWriteFails() {
        Long ownerId = createUserId();
        Long noteId = insertNote(ownerId);
        jdbcTemplate.execute(
                "CREATE FUNCTION reject_note_tag_insert() RETURNS trigger LANGUAGE plpgsql AS "
                        + "$$ BEGIN RAISE EXCEPTION 'association rejected'; END; $$");
        jdbcTemplate.execute(
                "CREATE TRIGGER reject_note_tag_insert BEFORE INSERT ON note_tag "
                        + "FOR EACH ROW EXECUTE FUNCTION reject_note_tag_insert()");

        try {
            assertThatThrownBy(
                            () ->
                                    inWriteTransaction(
                                            () ->
                                                    assignmentService.replace(
                                                            ownerId,
                                                            noteId,
                                                            List.of(
                                                                    new NoteTagSelection(
                                                                            null, "Rollback")))))
                    .isInstanceOf(RuntimeException.class)
                    .hasStackTraceContaining("association rejected");

            assertThat(tagExists(ownerId, "Rollback")).isFalse();
            assertThat(associationIds(ownerId, noteId)).isEmpty();
        } finally {
            jdbcTemplate.execute("DROP TRIGGER reject_note_tag_insert ON note_tag");
            jdbcTemplate.execute("DROP FUNCTION reject_note_tag_insert()");
        }
    }

    private boolean inWriteTransaction(Runnable action) {
        return new TransactionTemplate(transactionManager)
                .execute(
                        status -> {
                            action.run();
                            return true;
                        });
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

    private Long insertTask(Long userId) {
        return jdbcTemplate.queryForObject(
                "INSERT INTO task (user_id, task_key, title, inbox, created_at, updated_at) VALUES"
                    + " (?, ?, 'Task', FALSE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) RETURNING id",
                Long.class,
                userId,
                "TASK-" + UUID.randomUUID());
    }

    private Long insertTag(Long userId, String name) {
        return jdbcTemplate.queryForObject(
                "INSERT INTO tag (user_id, name, created_at, updated_at) "
                        + "VALUES (?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) RETURNING id",
                Long.class,
                userId,
                name);
    }

    private List<Long> associationIds(Long ownerId, Long noteId) {
        return jdbcTemplate.query(
                "SELECT note_tag.tag_id FROM note_tag JOIN note ON note.id = note_tag.note_id "
                        + "WHERE note.user_id = ? AND note.id = ? ORDER BY note_tag.tag_id",
                (rs, row) -> rs.getLong("tag_id"),
                ownerId,
                noteId);
    }

    private Long tagId(Long ownerId, String name) {
        return jdbcTemplate.queryForObject(
                "SELECT id FROM tag WHERE user_id = ? AND name = ?", Long.class, ownerId, name);
    }

    private boolean tagExists(Long ownerId, String name) {
        return Boolean.TRUE.equals(
                jdbcTemplate.queryForObject(
                        "SELECT EXISTS (SELECT 1 FROM tag WHERE user_id = ? AND name = ?)",
                        Boolean.class,
                        ownerId,
                        name));
    }
}
