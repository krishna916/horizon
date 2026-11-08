package com.krishnamurti.horizon.note.infrastructure;

import com.krishnamurti.horizon.note.application.NoteCollection;
import com.krishnamurti.horizon.note.application.NoteCounts;
import com.krishnamurti.horizon.note.application.NoteSort;
import com.krishnamurti.horizon.note.domain.Note;
import edu.umd.cs.findbugs.annotations.SuppressFBWarnings;
import jakarta.persistence.EntityManager;
import java.util.List;
import org.springframework.stereotype.Repository;

/** Fixed-query persistence for owner-scoped Note collection pages and counts. */
@Repository
public class NoteCollectionRepository {

    private final EntityManager entityManager;

    @SuppressFBWarnings(
            value = "EI_EXPOSE_REP2",
            justification = "The injected EntityManager is a private final managed dependency.")
    public NoteCollectionRepository(EntityManager entityManager) {
        this.entityManager = entityManager;
    }

    public List<Note> findPage(
            Long userId, NoteCollection collection, NoteSort sort, int offset, int limit) {
        String lifecycle =
                switch (collection) {
                    case ACTIVE -> "n.archived_at IS NULL";
                    case ARCHIVED -> "n.archived_at IS NOT NULL";
                };
        String ordering =
                switch (sort) {
                    case UPDATED_DESC -> "n.updated_at DESC, n.id DESC";
                    case UPDATED_ASC -> "n.updated_at ASC, n.id ASC";
                    case TITLE_ASC ->
                            "CASE WHEN n.title IS NULL THEN 1 ELSE 0 END ASC, LOWER(n.title) ASC,"
                                    + " n.id ASC";
                };
        String sql =
                "SELECT n.* FROM note n WHERE n.user_id = :userId AND n.deleted_at IS NULL AND "
                        + lifecycle
                        + " ORDER BY "
                        + ordering
                        + " LIMIT :limit OFFSET :offset";
        return entityManager
                .createNativeQuery(sql, Note.class)
                .setParameter("userId", userId)
                .setParameter("limit", limit)
                .setParameter("offset", offset)
                .getResultList();
    }

    public NoteCounts countForUser(Long userId) {
        Object[] counts =
                (Object[])
                        entityManager
                                .createNativeQuery(
                                        "SELECT count(*) FILTER (WHERE archived_at IS NULL),"
                                            + " count(*) FILTER (WHERE archived_at IS NOT NULL)"
                                            + " FROM note WHERE user_id = :userId AND deleted_at IS"
                                            + " NULL")
                                .setParameter("userId", userId)
                                .getSingleResult();
        return new NoteCounts(((Number) counts[0]).longValue(), ((Number) counts[1]).longValue());
    }
}
