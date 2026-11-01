package com.krishnamurti.horizon.tag.application;

import com.krishnamurti.horizon.tag.api.InvalidTagNameException;
import com.krishnamurti.horizon.tag.api.TagQueryApi;
import com.krishnamurti.horizon.tag.api.TagReference;
import com.krishnamurti.horizon.tag.domain.InvalidTagException;
import com.krishnamurti.horizon.tag.domain.Tag;
import com.krishnamurti.horizon.tag.domain.TagNamePolicy;
import com.krishnamurti.horizon.tag.infrastructure.TagRepository;
import com.krishnamurti.horizon.tag.infrastructure.TagSuggestionRepository;
import java.util.List;
import java.util.Optional;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Owner-scoped Tag lookup and suggestion operations. */
@Service
@Transactional(readOnly = true)
public class TagQueryService implements TagQueryApi {

    private final TagRepository tagRepository;
    private final TagSuggestionRepository tagSuggestionRepository;

    public TagQueryService(
            TagRepository tagRepository, TagSuggestionRepository tagSuggestionRepository) {
        this.tagRepository = tagRepository;
        this.tagSuggestionRepository = tagSuggestionRepository;
    }

    @Override
    public Optional<TagReference> findById(Long userId, Long tagId) {
        return tagRepository.findByIdAndUserId(tagId, userId).map(TagQueryService::toReference);
    }

    @Override
    public List<TagReference> suggest(Long userId, String prefix) {
        String normalizedPrefix;
        try {
            normalizedPrefix = TagNamePolicy.normalizeSuggestionPrefix(prefix);
        } catch (InvalidTagException exception) {
            throw new InvalidTagNameException("prefix", exception.getMessage());
        }
        if (normalizedPrefix.isEmpty()) {
            return List.of();
        }
        return tagSuggestionRepository.suggest(userId, normalizedPrefix);
    }

    private static TagReference toReference(Tag tag) {
        return new TagReference(tag.getId(), tag.getName());
    }
}
