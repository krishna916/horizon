package com.krishnamurti.horizon.task.infrastructure;

import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;
import org.springframework.jdbc.core.JdbcOperations;
import org.springframework.stereotype.Repository;

/** Persists Task-owned links to reusable Tags using scalar identifiers only. */
@Repository
public class TaskTagAssociationRepository {

    private static final String FIND_FOR_TASK_SQL =
            "SELECT task_tag.tag_id FROM task_tag "
                    + "JOIN task ON task.id = task_tag.task_id "
                    + "WHERE task.user_id = ? AND task.id = ? ORDER BY task_tag.tag_id";

    private static final String DELETE_FOR_TASK_SQL =
            "DELETE FROM task_tag USING task "
                    + "WHERE task_tag.task_id = task.id AND task.user_id = ? AND task.id = ?";

    private final JdbcOperations jdbcOperations;

    public TaskTagAssociationRepository(JdbcOperations jdbcOperations) {
        this.jdbcOperations = jdbcOperations;
    }

    public Map<Long, List<Long>> findTagIdsByTaskIds(Long userId, Collection<Long> taskIds) {
        if (taskIds.isEmpty()) {
            return Map.of();
        }

        List<Long> ids = List.copyOf(taskIds);
        String placeholders = ids.stream().map(ignored -> "?").collect(Collectors.joining(", "));
        String sql =
                "SELECT task_tag.task_id, task_tag.tag_id FROM task_tag "
                        + "JOIN task ON task.id = task_tag.task_id "
                        + "WHERE task.user_id = ? AND task.id IN (%s) "
                        + "ORDER BY task_tag.task_id, task_tag.tag_id";
        Map<Long, List<Long>> tagIdsByTask = new LinkedHashMap<>();
        List<Object> parameters = new ArrayList<>(ids.size() + 1);
        parameters.add(userId);
        parameters.addAll(ids);
        jdbcOperations.query(
                sql.formatted(placeholders),
                resultSet -> {
                    Long taskId = resultSet.getLong("task_id");
                    Long tagId = resultSet.getLong("tag_id");
                    tagIdsByTask.computeIfAbsent(taskId, ignored -> new ArrayList<>()).add(tagId);
                },
                parameters.toArray());
        return Map.copyOf(tagIdsByTask);
    }

    public Set<Long> findTagIdsForTask(Long userId, Long taskId) {
        return Set.copyOf(
                jdbcOperations.query(
                        FIND_FOR_TASK_SQL,
                        (resultSet, rowNumber) -> resultSet.getLong("tag_id"),
                        userId,
                        taskId));
    }

    /** Replaces links only when the Task belongs to the supplied owner. */
    public void replace(Long userId, Long taskId, Set<Long> tagIds) {
        boolean ownedTask =
                Boolean.TRUE.equals(
                        jdbcOperations.queryForObject(
                                "SELECT EXISTS (SELECT 1 FROM task WHERE id = ? AND user_id = ?)",
                                Boolean.class,
                                taskId,
                                userId));
        if (!ownedTask) {
            return;
        }

        jdbcOperations.update(DELETE_FOR_TASK_SQL, userId, taskId);
        if (tagIds.isEmpty()) {
            return;
        }

        jdbcOperations.batchUpdate(
                "INSERT INTO task_tag (task_id, tag_id) VALUES (?, ?)",
                tagIds,
                tagIds.size(),
                (statement, tagId) -> {
                    statement.setLong(1, taskId);
                    statement.setLong(2, tagId);
                });
    }
}
