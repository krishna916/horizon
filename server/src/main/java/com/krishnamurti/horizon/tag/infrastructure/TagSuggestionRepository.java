package com.krishnamurti.horizon.tag.infrastructure;

import com.krishnamurti.horizon.tag.api.TagReference;
import java.util.List;
import org.springframework.jdbc.core.JdbcOperations;
import org.springframework.stereotype.Repository;

/** Performs owner-filtered literal-prefix searches over persisted Tags. */
@Repository
public class TagSuggestionRepository {

    private static final int MAX_SUGGESTIONS = 10;

    private final JdbcOperations jdbcOperations;

    public TagSuggestionRepository(JdbcOperations jdbcOperations) {
        this.jdbcOperations = jdbcOperations;
    }

    public List<TagReference> suggest(Long userId, String normalizedPrefix) {
        String pattern = escapeLikeMetacharacters(normalizedPrefix) + "%";
        return jdbcOperations.query(
                "SELECT id, name FROM tag "
                        + "WHERE user_id = ? AND lower(name) LIKE lower(?) ESCAPE '!' "
                        + "ORDER BY lower(name) ASC, name ASC, id ASC LIMIT "
                        + MAX_SUGGESTIONS,
                (resultSet, rowNum) ->
                        new TagReference(resultSet.getLong("id"), resultSet.getString("name")),
                userId,
                pattern);
    }

    private String escapeLikeMetacharacters(String prefix) {
        StringBuilder pattern = new StringBuilder(prefix.length());
        for (int offset = 0; offset < prefix.length(); offset++) {
            char character = prefix.charAt(offset);
            if (character == '!' || character == '%' || character == '_') {
                pattern.append('!');
            }
            pattern.append(character);
        }
        return pattern.toString();
    }
}
