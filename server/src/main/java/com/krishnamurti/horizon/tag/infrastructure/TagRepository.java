package com.krishnamurti.horizon.tag.infrastructure;

import com.krishnamurti.horizon.tag.domain.Tag;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

/** Internal persistence interface for Tag aggregates. */
public interface TagRepository extends JpaRepository<Tag, Long> {

    Optional<Tag> findByIdAndUserId(Long id, Long userId);

    List<Tag> findAllByUserIdAndIdIn(Long userId, List<Long> ids);
}
