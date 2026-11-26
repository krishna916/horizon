package com.krishnamurti.horizon.file.api.model;

import java.util.Objects;

public record FileDescriptor(
        String originalFilename,
        String declaredContentType,
        long expectedSize,
        String expectedSha256) {
    public FileDescriptor {
        Objects.requireNonNull(originalFilename);
        Objects.requireNonNull(declaredContentType);
        Objects.requireNonNull(expectedSha256);
        if (originalFilename.isBlank()
                || originalFilename.length() > 255
                || originalFilename.contains("/")
                || originalFilename.contains("\\")
                || originalFilename.chars().anyMatch(Character::isISOControl)) {
            throw new IllegalArgumentException("invalid originalFilename");
        }
        if (declaredContentType.isBlank()
                || declaredContentType.length() > 255
                || declaredContentType.chars().anyMatch(Character::isISOControl)
                || expectedSize <= 0
                || expectedSize > 104_857_600L) {
            throw new IllegalArgumentException("invalid file descriptor");
        }
        if (!expectedSha256.matches("[0-9a-f]{64}")) {
            throw new IllegalArgumentException("expectedSha256 must be lowercase SHA-256 hex");
        }
    }
}
