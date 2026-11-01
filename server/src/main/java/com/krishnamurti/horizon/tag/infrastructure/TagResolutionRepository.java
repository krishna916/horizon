package com.krishnamurti.horizon.tag.infrastructure;

import com.krishnamurti.horizon.tag.api.TagReference;
import java.util.List;
import org.springframework.jdbc.core.JdbcOperations;
import org.springframework.stereotype.Repository;

/** PostgreSQL persistence operations for conflict-safe Tag name resolution. */
@Repository
public class TagResolutionRepository {

    private final JdbcOperations jdbcOperations;

    public TagResolutionRepository(JdbcOperations jdbcOperations) {
        this.jdbcOperations = jdbcOperations;
    }

    public TagReference resolve(Long userId, String validatedName) {
        jdbcOperations.update(
                "INSERT INTO tag (user_id, name, created_at, updated_at) VALUES (?, ?,"
                        + " CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) ON CONFLICT DO NOTHING",
                userId,
                validatedName);

        List<TagReference> matches =
                jdbcOperations.query(
                        "SELECT id, name FROM tag WHERE user_id = ? AND lower(name) = lower(?)",
                        (resultSet, rowNum) ->
                                new TagReference(
                                        resultSet.getLong("id"), resultSet.getString("name")),
                        userId,
                        validatedName);
        if (matches.isEmpty()) {
            throw new IllegalStateException("Resolved Tag was not visible after insert-or-reuse.");
        }
        return matches.getFirst();
    }
}
