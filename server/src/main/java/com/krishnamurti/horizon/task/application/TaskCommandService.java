package com.krishnamurti.horizon.task.application;

import com.krishnamurti.horizon.shared.security.CurrentUserProvider;
import com.krishnamurti.horizon.task.domain.ChecklistItem;
import com.krishnamurti.horizon.task.domain.Task;
import com.krishnamurti.horizon.task.domain.TaskPriority;
import com.krishnamurti.horizon.task.infrastructure.ChecklistItemRepository;
import com.krishnamurti.horizon.task.infrastructure.TaskKeyAllocator;
import com.krishnamurti.horizon.task.infrastructure.TaskRepository;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import org.springframework.security.authentication.InsufficientAuthenticationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Transactional task write use cases. */
@Service
public class TaskCommandService {

    private final TaskRepository taskRepository;
    private final TaskKeyAllocator taskKeyAllocator;
    private final ChecklistItemRepository checklistItemRepository;
    private final CurrentUserProvider currentUserProvider;

    public TaskCommandService(
            TaskRepository taskRepository,
            TaskKeyAllocator taskKeyAllocator,
            ChecklistItemRepository checklistItemRepository,
            CurrentUserProvider currentUserProvider) {
        this.taskRepository = taskRepository;
        this.taskKeyAllocator = taskKeyAllocator;
        this.checklistItemRepository = checklistItemRepository;
        this.currentUserProvider = currentUserProvider;
    }

    @Transactional
    public Task create(
            String title,
            Map<String, Object> description,
            TaskPriority priority,
            LocalDate dueDate) {
        return create(title, description, priority, dueDate, List.of());
    }

    @Transactional
    public Task create(
            String title,
            Map<String, Object> description,
            TaskPriority priority,
            LocalDate dueDate,
            List<InitialChecklistItem> checklist) {
        Long userId = requireCurrentUserId();
        long number = taskKeyAllocator.allocateNextNumber(userId);
        Task task = Task.create(userId, "TASK-" + number, title, description, priority, dueDate);
        Task saved = taskRepository.saveAndFlush(task);
        List<ChecklistItem> items =
                java.util.stream.IntStream.range(0, checklist.size())
                        .mapToObj(
                                position -> {
                                    InitialChecklistItem draft = checklist.get(position);
                                    return ChecklistItem.create(
                                            saved.getId(),
                                            draft.title(),
                                            draft.dueDate(),
                                            position);
                                })
                        .toList();
        checklistItemRepository.saveAllAndFlush(items);
        return saved;
    }

    @Transactional
    public Task update(Long taskId, TaskPatch patch) {
        Long userId = requireCurrentUserId();
        Task task =
                taskRepository
                        .findByIdAndUserIdAndDeletedAtIsNull(taskId, userId)
                        .orElseThrow(TaskNotFoundException::new);

        if (patch.title().present()) {
            task.updateTitle(patch.title().value());
        }
        if (patch.description().present()) {
            task.updateDescription(patch.description().value());
        }
        if (patch.priority().present()) {
            task.updatePriority(patch.priority().value());
        }
        if (patch.dueDate().present()) {
            task.updateDueDate(patch.dueDate().value());
        }

        return taskRepository.saveAndFlush(task);
    }

    @Transactional
    public Task complete(Long taskId) {
        Long userId = requireCurrentUserId();
        Task task =
                taskRepository
                        .findByIdAndUserIdAndDeletedAtIsNull(taskId, userId)
                        .orElseThrow(TaskNotFoundException::new);
        task.complete(OffsetDateTime.now(ZoneOffset.UTC));
        return taskRepository.saveAndFlush(task);
    }

    @Transactional
    public Task reopen(Long taskId) {
        Long userId = requireCurrentUserId();
        Task task =
                taskRepository
                        .findByIdAndUserIdAndDeletedAtIsNull(taskId, userId)
                        .orElseThrow(TaskNotFoundException::new);
        task.reopen();
        return taskRepository.saveAndFlush(task);
    }

    private Long requireCurrentUserId() {
        return currentUserProvider
                .getCurrentUserId()
                .orElseThrow(
                        () -> new InsufficientAuthenticationException("User is not authenticated"));
    }
}
