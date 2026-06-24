package com.krishnamurti.horizon.user.web;

import com.krishnamurti.horizon.shared.security.CurrentUserProvider;
import com.krishnamurti.horizon.user.application.UserCommandService;
import com.krishnamurti.horizon.user.application.UserQueryService;
import jakarta.validation.Valid;
import org.springframework.security.authentication.InsufficientAuthenticationException;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * REST controller for user resource operations.
 * Consolidates user profile and settings endpoints into a single resource boundary.
 */
@RestController
@RequestMapping("/api/v1/users")
public class UserController {

    private final UserQueryService userQueryService;
    private final UserCommandService userCommandService;
    private final CurrentUserProvider currentUserProvider;

    public UserController(
            UserQueryService userQueryService,
            UserCommandService userCommandService,
            CurrentUserProvider currentUserProvider) {
        this.userQueryService = userQueryService;
        this.userCommandService = userCommandService;
        this.currentUserProvider = currentUserProvider;
    }

    @GetMapping("/me")
    public CurrentUserResponse getCurrentUser() {
        return userQueryService.getCurrentUser();
    }

    @GetMapping("/me/settings")
    public UserSettingsResponse getSettings() {
        Long userId = currentUserProvider.getCurrentUserId()
            .orElseThrow(() -> new InsufficientAuthenticationException("User is not authenticated"));
        return userQueryService.getUserSettings(userId);
    }

    @PatchMapping("/me/settings")
    public UserSettingsResponse updateSettings(@Valid @RequestBody UpdateUserSettingsRequest request) {
        Long userId = currentUserProvider.getCurrentUserId()
            .orElseThrow(() -> new InsufficientAuthenticationException("User is not authenticated"));
        return userCommandService.updateUserSettings(userId, request.theme());
    }
}
