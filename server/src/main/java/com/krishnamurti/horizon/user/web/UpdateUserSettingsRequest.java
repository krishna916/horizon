package com.krishnamurti.horizon.user.web;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;

/** Request DTO for updating user settings. */
public record UpdateUserSettingsRequest(
        @NotNull(message = "Theme must not be null")
                @Pattern(
                        regexp = "^(LIGHT|DARK|SYSTEM)$",
                        message = "Theme must be LIGHT, DARK, or SYSTEM")
                String theme) {}
