package com.krishnamurti.horizon.file.application.port;

import java.nio.file.Path;
import java.util.Objects;

/** Request to write an already staged, validated object with an exact known length. */
public record ObjectWriteRequest(
        ObjectKey key, Path stagedPath, long contentLength, String contentType) {

    public ObjectWriteRequest {
        Objects.requireNonNull(key, "key");
        stagedPath = Objects.requireNonNull(stagedPath, "stagedPath").toAbsolutePath().normalize();
        Objects.requireNonNull(contentType, "contentType");
        if (contentLength <= 0) {
            throw new IllegalArgumentException("contentLength must be positive");
        }
        if (contentType.isBlank() || contentType.chars().anyMatch(Character::isISOControl)) {
            throw new IllegalArgumentException("contentType must be a non-blank media type");
        }
    }
}
