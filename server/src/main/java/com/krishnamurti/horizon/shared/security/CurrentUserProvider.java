package com.krishnamurti.horizon.shared.security;

import java.util.Optional;

public interface CurrentUserProvider {
    Optional<Long> getCurrentUserId();
}
