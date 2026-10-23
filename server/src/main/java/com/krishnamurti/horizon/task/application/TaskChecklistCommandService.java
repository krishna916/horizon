package com.krishnamurti.horizon.task.application;

import com.krishnamurti.horizon.shared.security.CurrentUserProvider;
import com.krishnamurti.horizon.task.domain.ChecklistItem;
import com.krishnamurti.horizon.task.domain.Task;
import com.krishnamurti.horizon.task.infrastructure.ChecklistItemRepository;
import com.krishnamurti.horizon.task.infrastructure.TaskRepository;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
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
