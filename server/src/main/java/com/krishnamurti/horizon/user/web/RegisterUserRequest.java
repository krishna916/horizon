package com.krishnamurti.horizon.user.web;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * Request DTO for user registration.
 *
 * <p>Controller-layer validation enforces structural constraints: email presence/format and minimum
 * password length. Business validation (duplicate detection) is handled by the application layer.
 */
public record RegisterUserRequest(
        @NotBlank(message = "Email is required")
                @Email(message = "Email must be a valid email address")
                String email,
        @NotBlank(message = "Password is required")
                @Size(min = 8, message = "Password must be at least 8 characters")
                String password) {}
