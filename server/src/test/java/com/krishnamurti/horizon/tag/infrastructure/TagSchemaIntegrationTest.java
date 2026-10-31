package com.krishnamurti.horizon.tag.infrastructure;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.krishnamurti.horizon.HorizonApplication;
import com.krishnamurti.horizon.TestcontainersConfiguration;
import java.sql.SQLException;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;

@SpringBootTest(
        classes = HorizonApplication.class,
        properties = "spring.jpa.hibernate.ddl-auto=validate")
@Import(TestcontainersConfiguration.class)
class TagSchemaIntegrationTest {

    @Autowired private JdbcTemplate jdbcTemplate;

    @Test
    void schemaHasRequiredColumnsAndIndex() {
        assertThat(
                        jdbcTemplate.queryForList(
                                "SELECT column_name FROM information_schema.columns WHERE"
                                        + " table_schema = current_schema() AND table_name = 'tag'"
                                        + " ORDER BY ordinal_position",
                                String.class))
                .containsExactly("id", "user_id", "name", "created_at", "updated_at");

        String indexDefinition =
                jdbcTemplate.queryForObject(
                        "SELECT indexdef FROM pg_indexes "
                                + "WHERE schemaname = current_schema() AND indexname = ?",
                        String.class,
                        "uk_tag_user_name_ci");
        assertThat(indexDefinition).contains("UNIQUE", "user_id", "lower");

        assertThat(constraintDefinition("fk_tag_users"))
                .contains("FOREIGN KEY (user_id)", "users(id)");
        assertThat(constraintDefinition("ck_tag_name_trimmed")).contains("btrim", "name");
    }

    @Test
    void duplicateNameIsBlockedPerOwner() {
        Long ownerId = createUserId();
        insertTag(ownerId, "Horizon");

        assertSqlState("23505", () -> insertTag(ownerId, "horizon"));
        assertSqlState("23505", () -> insertTag(ownerId, "HORIZON"));
    }

    @Test
    void sameNameIsAllowedForDifferentOwners() {
        insertTag(createUserId(), "Horizon");
        insertTag(createUserId(), "horizon");
    }

    @Test
    void rejectsInvalidRawDatabaseRows() {
        Long ownerId = createUserId();

        assertSqlState("23514", () -> insertTag(ownerId, ""));
        assertSqlState("23514", () -> insertTag(ownerId, "   "));
        assertSqlState("23514", () -> insertTag(ownerId, " Horizon"));
        assertSqlState("23514", () -> insertTag(ownerId, "Horizon "));
        assertSqlState("22001", () -> insertTag(ownerId, "x".repeat(101)));
        assertSqlState("23503", () -> insertTag(-1L, "Horizon"));
    }

    private Long createUserId() {
        return jdbcTemplate.queryForObject(
                "INSERT INTO users (email, password_hash, created_at, updated_at) VALUES (?,"
                        + " 'test-hash', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) RETURNING id",
                Long.class,
                UUID.randomUUID() + "@example.com");
    }

    private void insertTag(Long userId, String name) {
        jdbcTemplate.update(
                "INSERT INTO tag (user_id, name, created_at, updated_at) "
                        + "VALUES (?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)",
                userId,
                name);
    }

    private String constraintDefinition(String constraintName) {
        return jdbcTemplate.queryForObject(
                "SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = ?",
                String.class,
                constraintName);
    }

    private void assertSqlState(String expected, Runnable operation) {
        assertThatThrownBy(operation::run)
                .isInstanceOf(DataAccessException.class)
                .satisfies(exception -> assertThat(sqlState(exception)).isEqualTo(expected));
    }

    private String sqlState(Throwable failure) {
        Throwable cause = failure;
        while (cause != null) {
            if (cause instanceof SQLException sqlException) {
                return sqlException.getSQLState();
            }
            cause = cause.getCause();
        }
        return null;
    }
}
