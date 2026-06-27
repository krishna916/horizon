package com.krishnamurti.horizon.user.web;

import com.krishnamurti.horizon.user.application.UserCommandService;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * REST controller for authentication endpoints (register, login, logout). Consolidates
 * authentication operations into a single REST resource boundary.
 */
@RestController
@RequestMapping("/api/v1/auth")
public class AuthController {

    private final UserCommandService userCommandService;

    public AuthController(UserCommandService userCommandService) {
        this.userCommandService = userCommandService;
    }

    @PostMapping("/register")
    @ResponseStatus(HttpStatus.CREATED)
    public CurrentUserResponse register(@Valid @RequestBody RegisterUserRequest request) {
        return userCommandService.register(request.email(), request.password());
    }

    @PostMapping("/login")
    @ResponseStatus(HttpStatus.OK)
    public CurrentUserResponse login(@Valid @RequestBody LoginRequest request) {
        return userCommandService.login(request.email(), request.password());
    }

    @PostMapping("/logout")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void logout() {
        userCommandService.logout();
    }
}
