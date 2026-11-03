package com.krishnamurti.horizon.task.infrastructure;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.krishnamurti.horizon.HorizonApplication;
import com.krishnamurti.horizon.TestcontainersConfiguration;
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
class TaskTagAssociationRepositoryIntegrationTest {

    @Autowired private TaskTagAssociationRepository associationRepository;
    @Autowired private JdbcTemplate jdbcTemplate;

    @Test
    void migrationCreatesCompositeKeyForeignKeysAndReverseLookupIndex() {
        assertThat(constraintExists("pk_task_tag")).isTrue();
        assertThat(constraintExists("fk_task_tag_task")).isTrue();
        assertThat(constraintExists("fk_task_tag_tag")).isTrue();
        assertThat(indexExists("idx_task_tag_tag_id")).isTrue();
    }

    @Test
    void associationReadsAndReplacementAreTaskOwnerScopedAndKeepUnassignedTags() {
        Long ownerId = createUserId();
        Long otherOwnerId = createUserId();
        Long ownerTaskId = insertTask(ownerId, "TASK-1");
        Long otherTaskId = insertTask(otherOwnerId, "TASK-1");
        Long ownerTagId = insertTag(ownerId, "Horizon");
        Long otherTagId = insertTag(otherOwnerId, "Private");

        associationRepository.replace(ownerId, ownerTaskId, Set.of(ownerTagId));
        associationRepository.replace(ownerId, otherTaskId, Set.of(otherTagId));

        assertThat(associationRepository.findTagIdsForTask(ownerId, ownerTaskId))
                .containsExactly(ownerTagId);
        assertThat(associationRepository.findTagIdsForTask(ownerId, otherTaskId)).isEmpty();
        assertThat(
                        associationRepository.findTagIdsByTaskIds(
                                ownerId, Set.of(ownerTaskId, otherTaskId, Long.MAX_VALUE)))
                .containsOnlyKeys(ownerTaskId)
                .containsEntry(ownerTaskId, java.util.List.of(ownerTagId));

        associationRepository.replace(otherOwnerId, otherTaskId, Set.of(otherTagId));
        associationRepository.replace(ownerId, ownerTaskId, Set.of());

        assertThat(associationRepository.findTagIdsForTask(ownerId, ownerTaskId)).isEmpty();
        assertThat(tagExists(ownerTagId)).isTrue();
        assertThat(associationRepository.findTagIdsByTaskIds(ownerId, Set.of())).isEmpty();
    }

    @Test
    void databaseRejectsDuplicateLinksAndUnknownTaskOrTagIds() {
        Long ownerId = createUserId();
        Long taskId = insertTask(ownerId, "TASK-1");
        Long tagId = insertTag(ownerId, "Horizon");
        jdbcTemplate.update("INSERT INTO task_tag (task_id, tag_id) VALUES (?, ?)", taskId, tagId);

        assertThatThrownBy(
                        () ->
                                jdbcTemplate.update(
                                        "INSERT INTO task_tag (task_id, tag_id) VALUES (?, ?)",
                                        taskId,
                                        tagId))
                .isInstanceOf(DataIntegrityViolationException.class);
        assertThatThrownBy(
                        () ->
                                jdbcTemplate.update(
                                        "INSERT INTO task_tag (task_id, tag_id) VALUES (?, ?)",
                                        Long.MAX_VALUE,
                                        tagId))
                .isInstanceOf(DataIntegrityViolationException.class);
        assertThatThrownBy(
                        () ->
                                jdbcTemplate.update(
                                        "INSERT INTO task_tag (task_id, tag_id) VALUES (?, ?)",
                                        taskId,
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

    private Long insertTask(Long userId, String taskKey) {
        return jdbcTemplate.queryForObject(
                "INSERT INTO task (user_id, task_key, title, inbox, created_at, updated_at) "
                        + "VALUES (?, ?, 'Task', FALSE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) "
                        + "RETURNING id",
                Long.class,
                userId,
                taskKey);
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
