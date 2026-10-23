package com.krishnamurti.horizon.task.application;

import com.krishnamurti.horizon.shared.security.CurrentUserProvider;
import com.krishnamurti.horizon.task.domain.ChecklistItem;
import com.krishnamurti.horizon.task.domain.Task;
import com.krishnamurti.horizon.task.infrastructure.ChecklistItemRepository;
import com.krishnamurti.horizon.task.infrastructure.TaskRepository;
import java.util.List;
import org.springframework.security.authentication.InsufficientAuthenticationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Owner-scoped checklist reads, always traversing the task ownership boundary first. */
@Service
@Transactional(readOnly = true)
public class TaskChecklistQueryService {

    private final TaskRepository taskRepository;
    private final ChecklistItemRepository checklistItemRepository;
    private final CurrentUserProvider currentUserProvider;

    public TaskChecklistQueryService(
            TaskRepository taskRepository,
            ChecklistItemRepository checklistItemRepository,
            CurrentUserProvider currentUserProvider) {
        this.taskRepository = taskRepository;
        this.checklistItemRepository = checklistItemRepository;
        this.currentUserProvider = currentUserProvider;
    }

    public List<ChecklistItem> list(Long taskId) {
        Long userId = requireCurrentUserId();
        Task task = requireOwnedTask(taskId, userId);
        return checklistItemRepository.findAllByTaskIdAndDeletedAtIsNullOrderByPositionAscIdAsc(
                task.getId());
    }

    private Task requireOwnedTask(Long taskId, Long userId) {
        return taskRepository
                .findByIdAndUserIdAndDeletedAtIsNull(taskId, userId)
                .orElseThrow(TaskNotFoundException::new);
    }

    private Long requireCurrentUserId() {
        return currentUserProvider
                .getCurrentUserId()
                .orElseThrow(
                        () -> new InsufficientAuthenticationException("User is not authenticated"));
    }
}
