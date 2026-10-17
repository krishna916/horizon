package com.krishnamurti.horizon.task.application;

import com.krishnamurti.horizon.shared.security.CurrentUserProvider;
import com.krishnamurti.horizon.task.domain.Task;
import com.krishnamurti.horizon.task.infrastructure.TaskRepository;
import java.util.List;
import org.springframework.security.authentication.InsufficientAuthenticationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Transactional task read use cases. */
@Service
@Transactional(readOnly = true)
public class TaskQueryService {

    private final TaskRepository taskRepository;
    private final CurrentUserProvider currentUserProvider;

    public TaskQueryService(
            TaskRepository taskRepository, CurrentUserProvider currentUserProvider) {
        this.taskRepository = taskRepository;
        this.currentUserProvider = currentUserProvider;
    }

    public Task get(Long taskId) {
        Long userId = requireCurrentUserId();
        return taskRepository
                .findByIdAndUserIdAndDeletedAtIsNull(taskId, userId)
                .orElseThrow(TaskNotFoundException::new);
    }

    public List<Task> list() {
        Long userId = requireCurrentUserId();
        return taskRepository.findAllByUserIdAndDeletedAtIsNullOrderByCreatedAtDescIdDesc(userId);
    }

    private Long requireCurrentUserId() {
        return currentUserProvider
                .getCurrentUserId()
                .orElseThrow(
                        () -> new InsufficientAuthenticationException("User is not authenticated"));
    }
}
