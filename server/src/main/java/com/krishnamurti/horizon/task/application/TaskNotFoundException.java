package com.krishnamurti.horizon.task.application;

/** Represents both missing and non-owned tasks without disclosing ownership. */
public class TaskNotFoundException extends RuntimeException {

    public TaskNotFoundException() {
        super("Task not found");
    }
}
