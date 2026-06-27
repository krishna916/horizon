package com.krishnamurti.horizon.user.application;

import com.krishnamurti.horizon.shared.web.EmailAlreadyRegisteredException;
import com.krishnamurti.horizon.shared.web.InvalidCredentialsException;
import com.krishnamurti.horizon.user.domain.User;
import com.krishnamurti.horizon.user.domain.UserSettings;
import com.krishnamurti.horizon.user.infrastructure.UserRepository;
import com.krishnamurti.horizon.user.infrastructure.UserSettingsRepository;
import com.krishnamurti.horizon.user.web.CurrentUserResponse;
import com.krishnamurti.horizon.user.web.UserSettingsResponse;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.servlet.http.HttpSession;
import java.util.Locale;
import java.util.Objects;
import org.springframework.security.authentication.InsufficientAuthenticationException;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContext;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.context.HttpSessionSecurityContextRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

/**
 * Application service for user command operations.
 *
 * <p>Handles the registration use case: normalizes the email, verifies uniqueness, encodes the
 * password, creates the User aggregate, persists it, and returns the authenticated user
 * representation.
 *
 * <p>One use case = one transaction (ENG-001 §7).
 */
@Service
public class UserCommandService {

    private final UserRepository userRepository;
    private final UserSettingsRepository userSettingsRepository;
    private final PasswordEncoder passwordEncoder;

    public UserCommandService(
            UserRepository userRepository,
            UserSettingsRepository userSettingsRepository,
            PasswordEncoder passwordEncoder) {
        this.userRepository = userRepository;
        this.userSettingsRepository = userSettingsRepository;
        this.passwordEncoder = passwordEncoder;
    }

    /**
     * Registers a new user account.
     *
     * @param email the raw email address provided by the user
     * @param rawPassword the raw password provided by the user
     * @return the authenticated user representation
     * @throws EmailAlreadyRegisteredException if the email is already registered
     */
    @Transactional
    public CurrentUserResponse register(String email, String rawPassword) {
        String normalizedEmail = email.toLowerCase(Locale.ROOT).trim();

        if (userRepository.existsByEmail(normalizedEmail)) {
            throw new EmailAlreadyRegisteredException(normalizedEmail);
        }

        String encodedPassword = passwordEncoder.encode(rawPassword);
        User user = Objects.requireNonNull(User.create(normalizedEmail, encodedPassword));
        userRepository.save(user);

        UserSettings settings = UserSettings.createDefault(user);
        userSettingsRepository.save(settings);

        return new CurrentUserResponse(user.getId(), user.getEmail());
    }

    /**
     * Authenticates an existing user and establishes an authenticated session.
     *
     * @param email the user's email address
     * @param rawPassword the user's raw password
     * @return the authenticated user representation
     * @throws InvalidCredentialsException if the email is not found or password is incorrect
     */
    @Transactional
    public CurrentUserResponse login(String email, String rawPassword) {
        String normalizedEmail = email.toLowerCase(Locale.ROOT).trim();
        User user =
                userRepository
                        .findByEmail(normalizedEmail)
                        .orElseThrow(InvalidCredentialsException::new);

        if (!passwordEncoder.matches(rawPassword, user.getPasswordHash())) {
            throw new InvalidCredentialsException();
        }

        ServletRequestAttributes attributes =
                (ServletRequestAttributes) RequestContextHolder.getRequestAttributes();
        if (attributes != null) {
            HttpServletRequest request = attributes.getRequest();
            HttpServletResponse response = attributes.getResponse();

            // Session fixation protection: invalidate old session
            HttpSession session = request.getSession(false);
            if (session != null) {
                session.invalidate();
            }

            // Create new session (side-effect: establishes a fresh session after invalidation)
            request.getSession(true);

            // Set Spring Security context
            UsernamePasswordAuthenticationToken authentication =
                    new UsernamePasswordAuthenticationToken(
                            user.getId(),
                            null,
                            java.util.List.of(
                                    new org.springframework.security.core.authority
                                            .SimpleGrantedAuthority("ROLE_USER")));
            SecurityContext context = SecurityContextHolder.createEmptyContext();
            context.setAuthentication(authentication);
            SecurityContextHolder.setContext(context);

            // Persist the SecurityContext to the session
            new HttpSessionSecurityContextRepository().saveContext(context, request, response);
        }

        return new CurrentUserResponse(user.getId(), user.getEmail());
    }

    /** Terminates the current user session and clears security context. */
    @Transactional
    public void logout() {
        ServletRequestAttributes attributes =
                (ServletRequestAttributes) RequestContextHolder.getRequestAttributes();
        if (attributes != null) {
            HttpServletRequest request = attributes.getRequest();
            HttpSession session = request.getSession(false);
            if (session != null) {
                session.invalidate();
            }
        }
        SecurityContextHolder.clearContext();
    }

    /** Updates user settings for the specified user ID. */
    @Transactional
    public UserSettingsResponse updateUserSettings(Long userId, String theme) {
        UserSettings settings =
                userSettingsRepository
                        .findByUserId(userId)
                        .orElseGet(
                                () -> {
                                    User user =
                                            userRepository
                                                    .findById(userId)
                                                    .orElseThrow(
                                                            () ->
                                                                    new InsufficientAuthenticationException(
                                                                            "User not found"));
                                    return UserSettings.createDefault(user);
                                });

        settings.setTheme(theme);
        userSettingsRepository.save(settings);

        return new UserSettingsResponse(settings.getTheme());
    }
}
