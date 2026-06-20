package com.krishnamurti.horizon.shared.infrastructure;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import static org.assertj.core.api.Assertions.assertThat;

@SpringBootTest
@Testcontainers
class DatabaseMigrationTest {

    @Container
    static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:17");

    @DynamicPropertySource
    static void configureProperties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", postgres::getJdbcUrl);
        registry.add("spring.datasource.username", postgres::getUsername);
        registry.add("spring.datasource.password", postgres::getPassword);
        registry.add("spring.jpa.hibernate.ddl-auto", () -> "validate");
    }

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @Test
    void shouldMigrateBootstrapSchema() {
        // Check that Flyway migrated the bootstrap schema tables
        Boolean usersTableExists = jdbcTemplate.queryForObject(
            "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'users')", Boolean.class);
        Boolean sessionTableExists = jdbcTemplate.queryForObject(
            "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'spring_session')", Boolean.class);
        Boolean attributesTableExists = jdbcTemplate.queryForObject(
            "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'spring_session_attributes')", Boolean.class);

        assertThat(usersTableExists).isTrue();
        assertThat(sessionTableExists).isTrue();
        assertThat(attributesTableExists).isTrue();
    }
}
