package com.krishnamurti.horizon.task.application;

/** Signals that a creation key cannot be replayed for the submitted request. */
public class TaskCreationConflictException extends RuntimeException {

    public TaskCreationConflictException() {
        super("The task creation request key cannot be replayed for this request.");
    }
}
