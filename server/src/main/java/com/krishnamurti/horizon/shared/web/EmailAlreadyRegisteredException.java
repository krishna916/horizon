package com.krishnamurti.horizon.shared.web;

/**
 * Thrown when a registration attempt uses an email address that is already registered.
 *
 * <p>Maps to HTTP 409 Conflict via {@link GlobalExceptionHandler}.
 */
public class EmailAlreadyRegisteredException extends RuntimeException {

    private final String email;

    public EmailAlreadyRegisteredException(String email) {
        super("A user with email '" + email + "' is already registered.");
        this.email = email;
    }

    public String getEmail() {
        return email;
    }
}
