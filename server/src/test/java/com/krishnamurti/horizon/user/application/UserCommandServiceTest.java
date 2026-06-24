package com.krishnamurti.horizon.user.application;

import com.krishnamurti.horizon.shared.web.EmailAlreadyRegisteredException;
import com.krishnamurti.horizon.user.domain.User;
import com.krishnamurti.horizon.user.infrastructure.UserRepository;
import com.krishnamurti.horizon.user.infrastructure.UserSettingsRepository;
import com.krishnamurti.horizon.user.web.CurrentUserResponse;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.security.crypto.password.PasswordEncoder;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatExceptionOfType;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Unit tests for {@link UserCommandService}.
 *
 * <p>Tests the registration use case in isolation using Mockito mocks.
 * Verifies email normalization, duplicate detection, password encoding,
 * and correct response mapping.</p>
 */
@ExtendWith(MockitoExtension.class)
class UserCommandServiceTest {

    @Mock
    private UserRepository userRepository;

    @Mock
    private UserSettingsRepository userSettingsRepository;

    @Mock
    private PasswordEncoder passwordEncoder;

    @InjectMocks
    private UserCommandService userCommandService;

    @Test
    void shouldRegisterNewUser() {
        when(userRepository.existsByEmail("user@example.com")).thenReturn(false);
        when(passwordEncoder.encode("rawPassword123")).thenReturn("$2a$10$encoded");
        when(userRepository.save(any(User.class))).thenAnswer(invocation -> {
            User user = invocation.getArgument(0);
            user.setId(1L);
            return user;
        });

        CurrentUserResponse response = userCommandService.register("User@Example.COM", "rawPassword123");

        assertThat(response.id()).isEqualTo(1L);
        assertThat(response.email()).isEqualTo("user@example.com");
    }

    @Test
    void shouldThrowWhenEmailAlreadyExists() {
        when(userRepository.existsByEmail("user@example.com")).thenReturn(true);

        assertThatExceptionOfType(EmailAlreadyRegisteredException.class)
            .isThrownBy(() -> userCommandService.register("User@Example.COM", "rawPassword123"))
            .withMessage("A user with email 'user@example.com' is already registered.");

        verify(passwordEncoder, never()).encode(anyString());
        verify(userRepository, never()).save(any(User.class));
    }

    @Test
    void shouldNormalizeEmailToLowerCase() {
        when(userRepository.existsByEmail("user@example.com")).thenReturn(false);
        when(passwordEncoder.encode("password123")).thenReturn("$2a$10$encoded");
        when(userRepository.save(any(User.class))).thenAnswer(invocation -> {
            User user = invocation.getArgument(0);
            user.setId(1L);
            return user;
        });

        userCommandService.register("USER@EXAMPLE.COM", "password123");

        ArgumentCaptor<User> userCaptor = ArgumentCaptor.forClass(User.class);
        verify(userRepository).save(userCaptor.capture());
        assertThat(userCaptor.getValue().getEmail()).isEqualTo("user@example.com");
    }

    @Test
    void shouldTrimEmailWhitespace() {
        when(userRepository.existsByEmail("user@example.com")).thenReturn(false);
        when(passwordEncoder.encode("password123")).thenReturn("$2a$10$encoded");
        when(userRepository.save(any(User.class))).thenAnswer(invocation -> {
            User user = invocation.getArgument(0);
            user.setId(1L);
            return user;
        });

        userCommandService.register("  user@example.com  ", "password123");

        ArgumentCaptor<User> userCaptor = ArgumentCaptor.forClass(User.class);
        verify(userRepository).save(userCaptor.capture());
        assertThat(userCaptor.getValue().getEmail()).isEqualTo("user@example.com");
    }

    @Test
    void shouldEncodePasswordBeforePersistence() {
        when(userRepository.existsByEmail("user@example.com")).thenReturn(false);
        when(passwordEncoder.encode("rawPassword123")).thenReturn("$2a$10$encoded");
        when(userRepository.save(any(User.class))).thenAnswer(invocation -> {
            User user = invocation.getArgument(0);
            user.setId(1L);
            return user;
        });

        userCommandService.register("user@example.com", "rawPassword123");

        verify(passwordEncoder).encode("rawPassword123");

        ArgumentCaptor<User> userCaptor = ArgumentCaptor.forClass(User.class);
        verify(userRepository).save(userCaptor.capture());
        assertThat(userCaptor.getValue().getPasswordHash()).isEqualTo("$2a$10$encoded");
    }
}
