package com.krishnamurti.horizon.user.application;

import com.krishnamurti.horizon.shared.security.CurrentUserProvider;
import com.krishnamurti.horizon.user.domain.User;
import com.krishnamurti.horizon.user.domain.UserSettings;
import com.krishnamurti.horizon.user.infrastructure.UserRepository;
import com.krishnamurti.horizon.user.infrastructure.UserSettingsRepository;
import com.krishnamurti.horizon.user.web.CurrentUserResponse;
import com.krishnamurti.horizon.user.web.UserSettingsResponse;
import org.springframework.security.authentication.InsufficientAuthenticationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@Transactional(readOnly = true)
public class UserQueryService {

    private final UserRepository userRepository;
    private final UserSettingsRepository userSettingsRepository;
    private final CurrentUserProvider currentUserProvider;

    public UserQueryService(
            UserRepository userRepository,
            UserSettingsRepository userSettingsRepository,
            CurrentUserProvider currentUserProvider) {
        this.userRepository = userRepository;
        this.userSettingsRepository = userSettingsRepository;
        this.currentUserProvider = currentUserProvider;
    }

    public CurrentUserResponse getCurrentUser() {
        Long userId = currentUserProvider.getCurrentUserId()
            .orElseThrow(() -> new InsufficientAuthenticationException("User is not authenticated"));

        User user = userRepository.findById(userId)
            .orElseThrow(() -> new InsufficientAuthenticationException("Authenticated user not found"));

        return new CurrentUserResponse(user.getId(), user.getEmail());
    }

    @Transactional
    public UserSettingsResponse getUserSettings(Long userId) {
        UserSettings settings = userSettingsRepository.findByUserId(userId)
            .orElseGet(() -> {
                User user = userRepository.findById(userId)
                    .orElseThrow(() -> new InsufficientAuthenticationException("User not found"));
                UserSettings newSettings = UserSettings.createDefault(user);
                return userSettingsRepository.save(newSettings);
            });

        return new UserSettingsResponse(settings.getTheme());
    }
}
