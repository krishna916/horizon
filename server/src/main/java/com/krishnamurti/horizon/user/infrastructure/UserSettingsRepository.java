package com.krishnamurti.horizon.user.infrastructure;

import com.krishnamurti.horizon.user.domain.UserSettings;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

/**
 * Spring Data JPA repository for the {@link UserSettings} aggregate.
 */
public interface UserSettingsRepository extends JpaRepository<UserSettings, Long> {

    Optional<UserSettings> findByUserId(Long userId);
}
