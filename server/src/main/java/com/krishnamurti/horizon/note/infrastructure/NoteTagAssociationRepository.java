package com.krishnamurti.horizon.note.infrastructure;

import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.jdbc.core.JdbcOperations;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

/** Persists Note-owned links to reusable Tags using scalar identifiers only. */
@Repository
public class NoteTagAssociationRepository {

    private static final String FIND_FOR_NOTE_SQL =
            "SELECT note_tag.tag_id FROM note_tag "
                    + "JOIN note ON note.id = note_tag.note_id "
                    + "WHERE note.user_id = ? AND note.id = ? ORDER BY note_tag.tag_id";

    private static final String DELETE_FOR_NOTE_SQL =
            "DELETE FROM note_tag USING note "
                    + "WHERE note_tag.note_id = note.id AND note.user_id = ? AND note.id = ?";

    private static final String FIND_FOR_NOTES_SQL =
            "SELECT note_tag.note_id, note_tag.tag_id FROM note_tag "
                    + "JOIN note ON note.id = note_tag.note_id "
                    + "WHERE note.user_id = :ownerId AND note.id IN (:noteIds) "
                    + "ORDER BY note_tag.note_id, note_tag.tag_id";

    private final JdbcOperations jdbcOperations;
    private final NamedParameterJdbcTemplate namedParameterJdbcTemplate;

    public NoteTagAssociationRepository(JdbcOperations jdbcOperations) {
        this.jdbcOperations = jdbcOperations;
        this.namedParameterJdbcTemplate = new NamedParameterJdbcTemplate(jdbcOperations);
    }

    public Map<Long, List<Long>> findTagIdsByNoteIds(Long ownerId, Collection<Long> noteIds) {
        if (noteIds.isEmpty()) {
            return Map.of();
        }

        List<Long> ids = List.copyOf(noteIds);
        Map<Long, List<Long>> tagIdsByNote = new LinkedHashMap<>();
        MapSqlParameterSource parameters =
                new MapSqlParameterSource().addValue("ownerId", ownerId).addValue("noteIds", ids);
        namedParameterJdbcTemplate.query(
                FIND_FOR_NOTES_SQL,
                parameters,
                resultSet -> {
                    Long noteId = resultSet.getLong("note_id");
                    Long tagId = resultSet.getLong("tag_id");
                    tagIdsByNote.computeIfAbsent(noteId, ignored -> new ArrayList<>()).add(tagId);
                });
        return Map.copyOf(tagIdsByNote);
    }

    public Set<Long> findTagIdsForNote(Long ownerId, Long noteId) {
        return Set.copyOf(
                jdbcOperations.query(
                        FIND_FOR_NOTE_SQL,
                        (resultSet, rowNumber) -> resultSet.getLong("tag_id"),
                        ownerId,
                        noteId));
    }

    /** Replaces links only when the Note belongs to the supplied owner. */
    public void replace(Long ownerId, Long noteId, Set<Long> tagIds) {
        boolean ownedNote =
                Boolean.TRUE.equals(
                        jdbcOperations.queryForObject(
                                "SELECT EXISTS (SELECT 1 FROM note WHERE id = ? AND user_id = ?)",
                                Boolean.class,
                                noteId,
                                ownerId));
        if (!ownedNote) {
            return;
        }

        jdbcOperations.update(DELETE_FOR_NOTE_SQL, ownerId, noteId);
        if (tagIds.isEmpty()) {
            return;
        }

        jdbcOperations.batchUpdate(
                "INSERT INTO note_tag (note_id, tag_id) VALUES (?, ?)",
                tagIds,
                tagIds.size(),
                (statement, tagId) -> {
                    statement.setLong(1, noteId);
                    statement.setLong(2, tagId);
                });
    }
}
