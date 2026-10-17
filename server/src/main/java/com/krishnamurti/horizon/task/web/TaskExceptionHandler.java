package com.krishnamurti.horizon.task.web;

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
@RestControllerAdvice(assignableTypes = TaskController.class)
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

    @ExceptionHandler(InvalidTaskException.class)
    @ResponseStatus(HttpStatus.BAD_REQUEST)
    public ProblemDetail handleInvalidTask(InvalidTaskException exception) {
        ProblemDetail detail = ProblemDetail.forStatus(HttpStatus.BAD_REQUEST);
        detail.setTitle("Validation Failed");
        detail.setDetail("The request body contains invalid fields.");
        detail.setProperty("errors", Map.of(exception.getField(), exception.getMessage()));
        return detail;
    }
}
