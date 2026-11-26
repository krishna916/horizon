package com.krishnamurti.horizon.file.api.model;

public record FileMetadata(
        String originalFilename,
        String declaredContentType,
        FileFormat validatedFormat,
        long sizeBytes,
        String sha256) {}
