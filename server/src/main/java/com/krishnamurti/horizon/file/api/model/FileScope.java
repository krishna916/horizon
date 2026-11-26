package com.krishnamurti.horizon.file.api.model;

import java.util.Objects;

public record FileScope(Long userId, String workspace, String bindingFingerprint) {
    public FileScope {
        if (userId == null || userId <= 0) {
            throw new IllegalArgumentException("userId must be positive");
        }
        Objects.requireNonNull(workspace);
        Objects.requireNonNull(bindingFingerprint);
        if (workspace.isBlank()
                || workspace.length() > 64
                || workspace.contains("/")
                || workspace.contains("\\")
                || workspace.contains("..")) {
            throw new IllegalArgumentException(
                    "workspace must be a non-empty path-safe identifier");
        }
        if (bindingFingerprint.isBlank()) {
            throw new IllegalArgumentException("bindingFingerprint must not be blank");
        }
    }
}
