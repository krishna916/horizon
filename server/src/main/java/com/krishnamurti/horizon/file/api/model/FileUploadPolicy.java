package com.krishnamurti.horizon.file.api.model;

import java.util.Set;

public record FileUploadPolicy(long maxFileSizeBytes, Set<FileFormat> supportedFormats) {
    public FileUploadPolicy {
        if (maxFileSizeBytes <= 0)
            throw new IllegalArgumentException("maxFileSizeBytes must be positive");
        supportedFormats = Set.copyOf(supportedFormats);
    }
}
