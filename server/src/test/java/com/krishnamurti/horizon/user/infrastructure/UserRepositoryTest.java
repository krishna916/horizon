package com.krishnamurti.horizon.user.infrastructure;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatExceptionOfType;

import com.krishnamurti.horizon.TestcontainersConfiguration;
import com.krishnamurti.horizon.user.domain.User;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.data.jpa.test.autoconfigure.DataJpaTest;
import org.springframework.boot.jdbc.test.autoconfigure.AutoConfigureTestDatabase;
import org.springframework.context.annotation.Import;
import org.springframework.dao.DataIntegrityViolationException;

/**
 * Repository tests for {@link UserRepository}.
 *
 * <p>Validates persistence behavior against PostgreSQL using Testcontainers. Uses @DataJpaTest for
 * a lightweight slice test with real database.
 */
@DataJpaTest(properties = "spring.jpa.hibernate.ddl-auto=create-drop")
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@Import(TestcontainersConfiguration.class)
class UserRepositoryTest {

    @Autowired private UserRepository userRepository;

    @Test
    void shouldSaveAndFindUserByEmail() {
        User user = User.create("user@example.com", "$2a$10$encodedHash");
        userRepository.saveAndFlush(user);

        User found = userRepository.findByEmail("user@example.com").orElseThrow();

        assertThat(found.getId()).isNotNull();
        assertThat(found.getEmail()).isEqualTo("user@example.com");
        assertThat(found.getPasswordHash()).isEqualTo("$2a$10$encodedHash");
        assertThat(found.getCreatedAt()).isNotNull();
        assertThat(found.getUpdatedAt()).isNotNull();
    }

    @Test
    void shouldReturnTrueWhenEmailExists() {
        User user = User.create("user@example.com", "$2a$10$encodedHash");
        userRepository.saveAndFlush(user);

        assertThat(userRepository.existsByEmail("user@example.com")).isTrue();
    }

    @Test
    void shouldReturnFalseWhenEmailDoesNotExist() {
        assertThat(userRepository.existsByEmail("nonexistent@example.com")).isFalse();
    }

    @Test
    void shouldEnforceUniqueEmail() {
        User user1 = User.create("user@example.com", "$2a$10$encodedHash");
        userRepository.saveAndFlush(user1);

        User user2 = User.create("user@example.com", "$2a$10$differentHash");

        assertThatExceptionOfType(DataIntegrityViolationException.class)
                .isThrownBy(() -> userRepository.saveAndFlush(user2));
    }

    @Test
    void shouldReturnEmptyWhenEmailNotFound() {
        assertThat(userRepository.findByEmail("nonexistent@example.com")).isEmpty();
    }
}
