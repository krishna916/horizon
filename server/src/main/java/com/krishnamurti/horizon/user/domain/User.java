package com.krishnamurti.horizon.user.domain;

import com.krishnamurti.horizon.shared.domain.BaseEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.Setter;

import java.util.Objects;

/**
 * User aggregate root.
 *
 * <p>Represents a registered Horizon user. The aggregate enforces the invariant
 * that a user always has a normalized email address and a password hash.
 * Plain-text passwords must never exist within the domain model.</p>
 */
@Entity
@Table(name = "users")
@Getter
@Setter
public class User extends BaseEntity {

    @Column(name = "email", nullable = false, unique = true, length = 255)
    private String email;

    @Column(name = "password_hash", nullable = false, length = 255)
    private String passwordHash;

    @Column(name = "first_name", length = 255)
    private String firstName;

    @Column(name = "last_name", length = 255)
    private String lastName;

    /** JPA constructor. */
    User() {}

    /**
     * Factory method for creating a new User aggregate.
     *
     * <p>Enforces domain invariants: the email must be normalized (lowercase)
     * and the password must already be encoded. Plain-text passwords are rejected
     * by design — the aggregate only stores password hashes.</p>
     *
     * @param normalizedEmail the user's email address, already normalized to lowercase
     * @param passwordHash    the encoded password hash (never plain-text)
     * @return a new User aggregate
     * @throws NullPointerException if normalizedEmail or passwordHash is null
     */
    public static User create(String normalizedEmail, String passwordHash) {
        User user = new User();
        user.email = Objects.requireNonNull(normalizedEmail, "email must not be null");
        user.passwordHash = Objects.requireNonNull(passwordHash, "passwordHash must not be null");
        return user;
    }
}
