package com.krishnamurti.horizon.task.application;

import com.krishnamurti.horizon.shared.security.CurrentUserProvider;
import com.krishnamurti.horizon.task.domain.Task;
import com.krishnamurti.horizon.task.domain.TaskPriority;
import com.krishnamurti.horizon.task.infrastructure.TaskCreationReceipt;
import com.krishnamurti.horizon.task.infrastructure.TaskCreationRequestRepository;
import com.krishnamurti.horizon.task.infrastructure.TaskRepository;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.security.authentication.InsufficientAuthenticationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Creates a task once per owner-scoped request key and replays its current resource state. */
@Service
public class IdempotentTaskCreationService {

    private final TaskCreationRequestRepository creationRequestRepository;
    private final TaskCommandService taskCommandService;
    private final TaskRepository taskRepository;
    private final CurrentUserProvider currentUserProvider;

    public IdempotentTaskCreationService(
            TaskCreationRequestRepository creationRequestRepository,
            TaskCommandService taskCommandService,
            TaskRepository taskRepository,
            CurrentUserProvider currentUserProvider) {
        this.creationRequestRepository = creationRequestRepository;
        this.taskCommandService = taskCommandService;
        this.taskRepository = taskRepository;
        this.currentUserProvider = currentUserProvider;
    }

    @Transactional
    public Task create(
            UUID requestKey,
            String title,
            Map<String, Object> description,
            TaskPriority priority,
            LocalDate dueDate) {
        return create(requestKey, title, description, priority, dueDate, List.of());
    }

    @Transactional
    public Task create(
            UUID requestKey,
            String title,
            Map<String, Object> description,
            TaskPriority priority,
            LocalDate dueDate,
            List<InitialChecklistItem> checklist) {
        Long userId =
                currentUserProvider
                        .getCurrentUserId()
                        .orElseThrow(
                                () ->
                                        new InsufficientAuthenticationException(
                                                "User is not authenticated"));
        String fingerprint =
                TaskCreationFingerprint.compute(title, description, priority, dueDate, checklist);

        if (creationRequestRepository.claim(userId, requestKey, fingerprint)) {
            Task task = taskCommandService.create(title, description, priority, dueDate, checklist);
            creationRequestRepository.complete(userId, requestKey, task.getId());
            return task;
        }

        TaskCreationReceipt receipt =
                creationRequestRepository
                        .find(userId, requestKey)
                        .orElseThrow(
                                () ->
                                        new IllegalStateException(
                                                "Task creation request claim could not be"
                                                        + " loaded."));
        if (!receipt.fingerprint().equals(fingerprint) || receipt.taskId() == null) {
            throw new TaskCreationConflictException();
        }

        return taskRepository
                .findByIdAndUserIdAndDeletedAtIsNull(receipt.taskId(), userId)
                .orElseThrow(TaskCreationConflictException::new);
    }
}
