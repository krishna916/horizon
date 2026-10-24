package com.krishnamurti.horizon.task.application;

import com.krishnamurti.horizon.shared.security.CurrentUserProvider;
import com.krishnamurti.horizon.task.domain.ChecklistItem;
import com.krishnamurti.horizon.task.domain.Task;
import com.krishnamurti.horizon.task.infrastructure.ChecklistItemRepository;
import com.krishnamurti.horizon.task.infrastructure.TaskRepository;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import org.springframework.security.authentication.InsufficientAuthenticationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Transactional commands for checklist children owned by a task. */
@Service
public class TaskChecklistCommandService {

    private final TaskRepository taskRepository;
    private final ChecklistItemRepository checklistItemRepository;
    private final CurrentUserProvider currentUserProvider;

    public TaskChecklistCommandService(
            TaskRepository taskRepository,
            ChecklistItemRepository checklistItemRepository,
            CurrentUserProvider currentUserProvider) {
        this.taskRepository = taskRepository;
        this.checklistItemRepository = checklistItemRepository;
        this.currentUserProvider = currentUserProvider;
    }

    @Transactional
    public ChecklistItem add(Long taskId, String title) {
        Long userId = requireCurrentUserId();
        Task task =
                taskRepository
                        .lockOwnedForChecklistWrite(taskId, userId)
                        .orElseThrow(TaskNotFoundException::new);
        List<ChecklistItem> items =
                checklistItemRepository.findAllByTaskIdAndDeletedAtIsNullOrderByPositionAscIdAsc(
                        task.getId());
        ChecklistItem item = ChecklistItem.create(task.getId(), title, null, items.size());
        return checklistItemRepository.saveAndFlush(item);
    }

    @Transactional
    public ChecklistItem patch(Long taskId, Long itemId, ChecklistItemPatch patch) {
        ChecklistItem item = findOwnedActiveItem(taskId, itemId);
        if (patch.title().present()) {
            item.updateTitle(patch.title().value());
        }
        if (patch.dueDate().present()) {
            item.updateDueDate(patch.dueDate().value());
        }
        return checklistItemRepository.saveAndFlush(item);
    }

    @Transactional
    public ChecklistItem complete(Long taskId, Long itemId) {
        ChecklistItem item = findOwnedActiveItem(taskId, itemId);
        item.complete(OffsetDateTime.now(ZoneOffset.UTC));
        return checklistItemRepository.saveAndFlush(item);
    }

    @Transactional
    public ChecklistItem reopen(Long taskId, Long itemId) {
        ChecklistItem item = findOwnedActiveItem(taskId, itemId);
        item.reopen();
        return checklistItemRepository.saveAndFlush(item);
    }

    @Transactional
    public List<ChecklistItem> reorder(Long taskId, List<Long> itemIds) {
        Task task = lockOwnedTask(taskId);
        List<ChecklistItem> active = findActiveItems(task.getId());
        if (itemIds == null) {
            throw new ChecklistOrderConflictException();
        }
        for (Long itemId : itemIds) {
            if (itemId == null) {
                throw new TaskNotFoundException();
            }
            if (checklistItemRepository
                    .findByIdAndTaskIdAndDeletedAtIsNull(itemId, task.getId())
                    .isEmpty()) {
                if (checklistItemRepository.findByIdAndTaskId(itemId, task.getId()).isPresent()) {
                    throw new ChecklistOrderConflictException();
                }
                throw new TaskNotFoundException();
            }
        }
        Set<Long> submitted = new HashSet<>(itemIds);
        if (submitted.size() != itemIds.size()
                || submitted.size() != active.size()
                || !active.stream()
                        .map(ChecklistItem::getId)
                        .collect(java.util.stream.Collectors.toSet())
                        .equals(submitted)) {
            throw new ChecklistOrderConflictException();
        }

        var activeById = new java.util.HashMap<Long, ChecklistItem>();
        active.forEach(item -> activeById.put(item.getId(), item));
        List<ChecklistItem> ordered = new ArrayList<>(itemIds.size());
        for (int position = 0; position < itemIds.size(); position++) {
            ChecklistItem item = activeById.get(itemIds.get(position));
            item.moveTo(position);
            ordered.add(item);
        }
        return checklistItemRepository.saveAllAndFlush(ordered);
    }

    @Transactional
    public void remove(Long taskId, Long itemId) {
        Task task = lockOwnedTask(taskId);
        List<ChecklistItem> active = findActiveItems(task.getId());
        ChecklistItem removed =
                active.stream()
                        .filter(item -> item.getId().equals(itemId))
                        .findFirst()
                        .orElseThrow(TaskNotFoundException::new);
        removed.softDelete(OffsetDateTime.now(ZoneOffset.UTC));
        normalize(active.stream().filter(item -> !item.getId().equals(removed.getId())).toList());
        checklistItemRepository.saveAllAndFlush(active);
    }

    @Transactional
    public ChecklistItem restore(Long taskId, Long itemId) {
        Task task = lockOwnedTask(taskId);
        ChecklistItem item =
                checklistItemRepository
                        .findByIdAndTaskId(itemId, task.getId())
                        .orElseThrow(TaskNotFoundException::new);
        if (item.getDeletedAt() == null) {
            return item;
        }
        List<ChecklistItem> active = findActiveItems(task.getId());
        int position = Math.min(item.getPosition(), active.size());
        List<ChecklistItem> restored = new ArrayList<>(active.size() + 1);
        for (ChecklistItem sibling : active) {
            if (sibling.getPosition() >= position) {
                sibling.moveTo(sibling.getPosition() + 1);
            }
            restored.add(sibling);
        }
        item.restore();
        item.moveTo(position);
        restored.add(item);
        restored.sort(Comparator.comparingInt(ChecklistItem::getPosition));
        normalize(restored);
        checklistItemRepository.saveAllAndFlush(restored);
        return item;
    }

    private Task lockOwnedTask(Long taskId) {
        Long userId = requireCurrentUserId();
        return taskRepository
                .lockOwnedForChecklistWrite(taskId, userId)
                .orElseThrow(TaskNotFoundException::new);
    }

    private List<ChecklistItem> findActiveItems(Long taskId) {
        return checklistItemRepository.findAllByTaskIdAndDeletedAtIsNullOrderByPositionAscIdAsc(
                taskId);
    }

    private void normalize(List<ChecklistItem> items) {
        for (int position = 0; position < items.size(); position++) {
            items.get(position).moveTo(position);
        }
    }

    private ChecklistItem findOwnedActiveItem(Long taskId, Long itemId) {
        Long userId = requireCurrentUserId();
        Task task =
                taskRepository
                        .findByIdAndUserIdAndDeletedAtIsNull(taskId, userId)
                        .orElseThrow(TaskNotFoundException::new);
        return checklistItemRepository
                .findByIdAndTaskIdAndDeletedAtIsNull(itemId, task.getId())
                .orElseThrow(TaskNotFoundException::new);
    }

    private Long requireCurrentUserId() {
        return currentUserProvider
                .getCurrentUserId()
                .orElseThrow(
                        () -> new InsufficientAuthenticationException("User is not authenticated"));
    }
}
