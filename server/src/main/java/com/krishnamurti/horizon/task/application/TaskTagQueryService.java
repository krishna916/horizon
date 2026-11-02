package com.krishnamurti.horizon.task.application;

import com.krishnamurti.horizon.tag.api.TagQueryApi;
import com.krishnamurti.horizon.tag.api.TagReference;
import com.krishnamurti.horizon.task.infrastructure.TaskTagAssociationRepository;
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

/** Batch-hydrates owner-scoped Task tag associations through the public Tag API. */
@Service
@Transactional(readOnly = true)
public class TaskTagQueryService {

    private static final Comparator<TagReference> TAG_ORDER =
            Comparator.comparing((TagReference tag) -> tag.name().toLowerCase(Locale.ROOT))
                    .thenComparing(TagReference::name)
                    .thenComparing(TagReference::id);

    private final TaskTagAssociationRepository associationRepository;
    private final TagQueryApi tagQueryApi;

    public TaskTagQueryService(
            TaskTagAssociationRepository associationRepository, TagQueryApi tagQueryApi) {
        this.associationRepository = associationRepository;
        this.tagQueryApi = tagQueryApi;
    }

    public Map<Long, List<TagReference>> tagsForTasks(Long ownerId, Collection<Long> taskIds) {
        if (taskIds.isEmpty()) {
            return Map.of();
        }

        Map<Long, List<Long>> tagIdsByTask =
                associationRepository.findTagIdsByTaskIds(ownerId, taskIds);
        Set<Long> tagIds = new LinkedHashSet<>();
        tagIdsByTask.values().forEach(tagIds::addAll);
        Map<Long, TagReference> tagsById = new LinkedHashMap<>();
        if (!tagIds.isEmpty()) {
            tagQueryApi.findAllByIds(ownerId, tagIds).forEach(tag -> tagsById.put(tag.id(), tag));
        }

        Map<Long, List<TagReference>> result = new LinkedHashMap<>();
        for (Long taskId : taskIds) {
            List<TagReference> tags =
                    tagIdsByTask.getOrDefault(taskId, List.of()).stream()
                            .map(tagsById::get)
                            .filter(tag -> tag != null)
                            .sorted(TAG_ORDER)
                            .toList();
            result.put(taskId, tags);
        }
        return Map.copyOf(result);
    }
}
