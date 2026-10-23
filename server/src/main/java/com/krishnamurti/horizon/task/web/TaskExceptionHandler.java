package com.krishnamurti.horizon.task.web;

import com.krishnamurti.horizon.task.application.ChecklistOrderConflictException;
import com.krishnamurti.horizon.task.application.TaskCreationConflictException;
import com.krishnamurti.horizon.task.application.TaskNotFoundException;
import com.krishnamurti.horizon.task.domain.InvalidTaskException;
import java.net.URI;
import java.util.Map;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestControllerAdvice;

/** Task-controller Problem Details for owner-safe not-found and domain validation failures. */
@RestControllerAdvice(assignableTypes = {TaskController.class, TaskChecklistController.class})
@Order(Ordered.HIGHEST_PRECEDENCE)
public class TaskExceptionHandler {

    @ExceptionHandler(TaskNotFoundException.class)
    @ResponseStatus(HttpStatus.NOT_FOUND)
    public ProblemDetail handleTaskNotFound(TaskNotFoundException exception) {
        ProblemDetail detail = ProblemDetail.forStatus(HttpStatus.NOT_FOUND);
        detail.setTitle("Task Not Found");
        detail.setDetail("The requested task was not found.");
        detail.setInstance(URI.create("/api/v1/tasks"));
        return detail;
    }

    @ExceptionHandler(TaskCreationConflictException.class)
    @ResponseStatus(HttpStatus.CONFLICT)
    public ProblemDetail handleTaskCreationConflict(TaskCreationConflictException exception) {
        ProblemDetail detail = ProblemDetail.forStatus(HttpStatus.CONFLICT);
        detail.setTitle("Task Creation Conflict");
        detail.setDetail("The task creation request cannot be replayed.");
        detail.setInstance(URI.create("/api/v1/tasks"));
        return detail;
    }

    @ExceptionHandler(ChecklistOrderConflictException.class)
    @ResponseStatus(HttpStatus.CONFLICT)
    public ProblemDetail handleChecklistOrderConflict(ChecklistOrderConflictException exception) {
        ProblemDetail detail = ProblemDetail.forStatus(HttpStatus.CONFLICT);
        detail.setTitle("Checklist Order Conflict");
        detail.setDetail(exception.getMessage());
        detail.setInstance(URI.create("/api/v1/tasks/checklist-items/order"));
        return detail;
    }

    @ExceptionHandler(InvalidTaskException.class)
    @ResponseStatus(HttpStatus.BAD_REQUEST)
    public ProblemDetail handleInvalidTask(InvalidTaskException exception) {
        return validationFailure(exception.getField(), exception.getMessage());
    }

    @ExceptionHandler(TaskRequestValidationException.class)
    @ResponseStatus(HttpStatus.BAD_REQUEST)
    public ProblemDetail handleInvalidRequest(TaskRequestValidationException exception) {
        return validationFailure(exception.getField(), exception.getMessage());
    }

    private ProblemDetail validationFailure(String field, String message) {
        ProblemDetail detail = ProblemDetail.forStatus(HttpStatus.BAD_REQUEST);
        detail.setTitle("Validation Failed");
        detail.setDetail("The request body contains invalid fields.");
        detail.setProperty("errors", Map.of(field, message));
        return detail;
    }
}
