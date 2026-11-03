package com.krishnamurti.horizon.task.application;

/** A Task tag selected by existing ID or a new name to resolve during save. */
public record TaskTagSelection(Long id, String name) {

    public TaskTagSelection {
        if ((id == null) == (name == null)) {
            throw new IllegalArgumentException("Exactly one of id or name must be supplied.");
        }
        if (id != null && id <= 0) {
            throw new IllegalArgumentException("Tag ID must be positive.");
        }
    }
}
