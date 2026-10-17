package com.krishnamurti.horizon.task.web;

/** Invalid client-supplied fields in a task request. */
public class TaskRequestValidationException extends RuntimeException {

    private final String field;

    public TaskRequestValidationException(String field, String message) {
        super(message);
        this.field = field;
    }

    public String getField() {
        return field;
    }
}
