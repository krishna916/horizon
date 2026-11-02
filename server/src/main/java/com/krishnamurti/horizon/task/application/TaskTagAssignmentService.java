package com.krishnamurti.horizon.task.application;

import com.krishnamurti.horizon.tag.api.TagCommandApi;
import com.krishnamurti.horizon.tag.api.TagQueryApi;
import com.krishnamurti.horizon.tag.api.TagReference;
import com.krishnamurti.horizon.task.domain.Task;
import com.krishnamurti.horizon.task.infrastructure.TaskRepository;
import com.krishnamurti.horizon.task.infrastructure.TaskTagAssociationRepository;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/** Resolves and atomically replaces Task associations through the public Tag API. */
@Service
public class TaskTagAssignmentService {

    private final TaskRepository taskRepository;
    private final TaskTagAssociationRepository associationRepository;
    private final TagQueryApi tagQueryApi;
    private final TagCommandApi tagCommandApi;

    public TaskTagAssignmentService(
            TaskRepository taskRepository,
            TaskTagAssociationRepository associationRepository,
            TagQueryApi tagQueryApi,
            TagCommandApi tagCommandApi) {
        this.taskRepository = taskRepository;
        this.associationRepository = associationRepository;
        this.tagQueryApi = tagQueryApi;
        this.tagCommandApi = tagCommandApi;
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public boolean replace(Long ownerId, Long taskId, List<TaskTagSelection> selections) {
        Task task =
                taskRepository
                        .lockOwnedForTagWrite(taskId, ownerId)
                        .orElseThrow(TaskNotFoundException::new);
        Set<Long> resolvedIds = resolve(ownerId, selections);
        Set<Long> currentIds = associationRepository.findTagIdsForTask(ownerId, taskId);
        if (currentIds.equals(resolvedIds)) {
            return false;
        }

        associationRepository.replace(ownerId, taskId, resolvedIds);
        task.touchMetadata(OffsetDateTime.now(ZoneOffset.UTC));
        taskRepository.saveAndFlush(task);
        return true;
    }

    private Set<Long> resolve(Long ownerId, List<TaskTagSelection> selections) {
        Set<Long> requestedIds = new LinkedHashSet<>();
        selections.stream()
                .map(TaskTagSelection::id)
                .filter(id -> id != null)
                .forEach(requestedIds::add);
        List<TagReference> ownedTags = tagQueryApi.findAllByIds(ownerId, requestedIds);
        if (ownedTags.size() != requestedIds.size()) {
            throw new TaskNotFoundException();
        }

        Set<Long> resolvedIds = new LinkedHashSet<>(requestedIds);
        for (TaskTagSelection selection : selections) {
            if (selection.name() != null) {
                TagReference tag = tagCommandApi.resolveByName(ownerId, selection.name());
                resolvedIds.add(tag.id());
            }
        }
        return Set.copyOf(resolvedIds);
    }
}
