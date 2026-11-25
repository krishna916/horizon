package com.krishnamurti.horizon.file.api.model;

import java.util.Objects;
import java.util.UUID;

public record FileReference(UUID fileId, FileScope scope) {
    public FileReference {
        Objects.requireNonNull(fileId);
        Objects.requireNonNull(scope);
    }
}
