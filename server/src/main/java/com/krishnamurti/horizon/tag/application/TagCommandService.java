package com.krishnamurti.horizon.tag.application;

import com.krishnamurti.horizon.tag.api.InvalidTagNameException;
import com.krishnamurti.horizon.tag.api.TagCommandApi;
import com.krishnamurti.horizon.tag.api.TagReference;
import com.krishnamurti.horizon.tag.domain.InvalidTagException;
import com.krishnamurti.horizon.tag.domain.TagNamePolicy;
import com.krishnamurti.horizon.tag.infrastructure.TagResolutionRepository;
import java.util.Objects;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/** Resolves a name to a persisted Tag within the calling content-assignment transaction. */
@Service
public class TagCommandService implements TagCommandApi {

    private final TagResolutionRepository tagResolutionRepository;

    public TagCommandService(TagResolutionRepository tagResolutionRepository) {
        this.tagResolutionRepository = tagResolutionRepository;
    }

    @Override
    @Transactional(propagation = Propagation.MANDATORY)
    public TagReference resolveByName(Long userId, String name) {
        Objects.requireNonNull(userId, "userId must not be null");
        try {
            return tagResolutionRepository.resolve(
                    userId, TagNamePolicy.normalizeRequiredName(name));
        } catch (InvalidTagException exception) {
            throw new InvalidTagNameException(exception.getField(), exception.getMessage());
        }
    }
}
