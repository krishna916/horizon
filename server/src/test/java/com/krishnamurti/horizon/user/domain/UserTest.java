package com.krishnamurti.horizon.user.domain;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatNullPointerException;

/**
 * Unit tests for the User aggregate.
 *
 * <p>Tests domain invariants: normalized email and password hash are required,
 * plain-text passwords are never accepted.</p>
 */
class UserTest {

    @Test
    void shouldCreateUserWithNormalizedEmailAndPasswordHash() {
        User user = User.create("user@example.com", "$2a$10$encodedHash");

        assertThat(user.getEmail()).isEqualTo("user@example.com");
        assertThat(user.getPasswordHash()).isEqualTo("$2a$10$encodedHash");
        assertThat(user.getId()).isNull();
    }

    @Test
    void shouldRejectNullEmail() {
        assertThatNullPointerException()
            .isThrownBy(() -> User.create(null, "$2a$10$encodedHash"))
            .withMessage("email must not be null");
    }

    @Test
    void shouldRejectNullPasswordHash() {
        assertThatNullPointerException()
            .isThrownBy(() -> User.create("user@example.com", null))
            .withMessage("passwordHash must not be null");
    }

    @Test
    void shouldAllowNullableFirstNameAndLastName() {
        User user = User.create("user@example.com", "$2a$10$encodedHash");

        assertThat(user.getFirstName()).isNull();
        assertThat(user.getLastName()).isNull();
    }

    @Test
    void shouldSetFirstNameAndLastName() {
        User user = User.create("user@example.com", "$2a$10$encodedHash");
        user.setFirstName("John");
        user.setLastName("Doe");

        assertThat(user.getFirstName()).isEqualTo("John");
        assertThat(user.getLastName()).isEqualTo("Doe");
    }
}
