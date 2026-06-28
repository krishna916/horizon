package com.krishnamurti.horizon.user.infrastructure;

import com.krishnamurti.horizon.user.domain.UserSettings;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

/** Spring Data JPA repository for the {@link UserSettings} aggregate. */
public interface UserSettingsRepository extends JpaRepository<UserSettings, Long> {

    Optional<UserSettings> findByUserId(Long userId);
}
