package com.krishnamurti.horizon.user.infrastructure;

import com.krishnamurti.horizon.user.domain.User;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

/**
 * Spring Data JPA repository for the {@link User} aggregate.
 *
 * <p>Provides persistence operations for the user module. Ownership filtering is not applicable to
 * registration (pre-authentication), but will be enforced for all other queries in future stories.
 */
public interface UserRepository extends JpaRepository<User, Long> {

    Optional<User> findByEmail(String email);

    boolean existsByEmail(String email);
}
