package com.krishnamurti.horizon.shared.security;

import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;

import java.util.Optional;

@Component
public class SpringSecurityCurrentUserProvider implements CurrentUserProvider {

    @Override
    public Optional<Long> getCurrentUserId() {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        if (authentication == null || !authentication.isAuthenticated()) {
            return Optional.empty();
        }
        Object principal = authentication.getPrincipal();
        if (principal instanceof Long) {
            return Optional.of((Long) principal);
        }
        return Optional.empty();
    }
}
