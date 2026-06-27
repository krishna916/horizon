package com.krishnamurti.horizon.user.web;

/**
 * Response DTO representing the authenticated user.
 *
 * <p>This is the canonical representation of the authenticated user, shared by:
 *
 * <ul>
 *   <li>{@code POST /api/v1/register} (201 Created)
 *   <li>{@code POST /api/v1/login} (200 OK)
 *   <li>{@code GET /api/v1/me} (200 OK)
 * </ul>
 *
 * Per M0-000, passwords are never included in API responses.
 */
public record CurrentUserResponse(Long id, String email) {}
