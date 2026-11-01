package com.krishnamurti.horizon.tag.api;

import java.util.List;
import java.util.Optional;

/** Public read operations offered by the Tag module to other modules. */
public interface TagQueryApi {

    Optional<TagReference> findById(Long userId, Long tagId);

    List<TagReference> suggest(Long userId, String prefix);
}
