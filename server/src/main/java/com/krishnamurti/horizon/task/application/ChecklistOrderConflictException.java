package com.krishnamurti.horizon.task.application;

/** Signals that a checklist reorder was submitted against a stale sibling set. */
public class ChecklistOrderConflictException extends RuntimeException {

    public ChecklistOrderConflictException() {
        super("Checklist item order changed. Reload the checklist and try again.");
    }
}
