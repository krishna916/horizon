package com.krishnamurti.horizon.file.infrastructure.validation;

import com.krishnamurti.horizon.file.api.model.FileFormat;
import java.util.Objects;

public record ValidationResult(FileFormat format, String mediaType) {
    public ValidationResult {
        Objects.requireNonNull(format);
        Objects.requireNonNull(mediaType);
    }
}
