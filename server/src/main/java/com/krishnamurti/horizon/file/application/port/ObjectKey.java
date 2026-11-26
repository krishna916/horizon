package com.krishnamurti.horizon.file.application.port;

import java.util.Objects;

/** A validated opaque key for an object in the private file store. */
public record ObjectKey(String value) {

    public ObjectKey {
        Objects.requireNonNull(value, "value");
        if (value.isBlank()
                || value.length() > 512
                || value.startsWith("/")
                || value.contains("..")) {
            throw new IllegalArgumentException(
                    "Object key must be a bounded relative opaque value");
        }
        if (value.chars().anyMatch(Character::isISOControl)) {
            throw new IllegalArgumentException("Object key must not contain control characters");
        }
    }
}
