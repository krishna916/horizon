package com.krishnamurti.horizon.note.application;

import com.krishnamurti.horizon.note.infrastructure.NoteTagAssociationRepository;
import com.krishnamurti.horizon.tag.api.TagQueryApi;
import com.krishnamurti.horizon.tag.api.TagReference;
import edu.umd.cs.findbugs.annotations.SuppressFBWarnings;
import java.util.Collection;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Batch-hydrates owner-scoped Note Tag associations through the public Tag API. */
@Service
@Transactional(readOnly = true)
public class NoteTagQueryService {

    private static final Comparator<TagReference> TAG_ORDER =
            Comparator.comparing((TagReference tag) -> tag.name().toLowerCase(Locale.ROOT))
                    .thenComparing(TagReference::name)
                    .thenComparing(TagReference::id);

    private final NoteTagAssociationRepository associationRepository;
    private final TagQueryApi tagQueryApi;

    @SuppressFBWarnings(
            value = "EI_EXPOSE_REP2",
            justification =
                    "The injected collaborators are private final Spring-managed dependencies.")
    public NoteTagQueryService(
            NoteTagAssociationRepository associationRepository, TagQueryApi tagQueryApi) {
        this.associationRepository = associationRepository;
        this.tagQueryApi = tagQueryApi;
    }

    public Map<Long, List<TagReference>> tagsForNotes(Long ownerId, Collection<Long> noteIds) {
        if (noteIds.isEmpty()) {
            return Map.of();
        }

        Map<Long, List<Long>> tagIdsByNote =
                associationRepository.findTagIdsByNoteIds(ownerId, noteIds);
        Set<Long> tagIds = new LinkedHashSet<>();
        tagIdsByNote.values().forEach(tagIds::addAll);
        Map<Long, TagReference> tagsById = new LinkedHashMap<>();
        if (!tagIds.isEmpty()) {
            tagQueryApi.findAllByIds(ownerId, tagIds).forEach(tag -> tagsById.put(tag.id(), tag));
        }

        Map<Long, List<TagReference>> result = new LinkedHashMap<>();
        for (Long noteId : noteIds) {
            List<TagReference> tags =
                    tagIdsByNote.getOrDefault(noteId, List.of()).stream()
                            .map(tagsById::get)
                            .filter(tag -> tag != null)
                            .sorted(TAG_ORDER)
                            .toList();
            result.put(noteId, tags);
        }
        return Map.copyOf(result);
    }
}
