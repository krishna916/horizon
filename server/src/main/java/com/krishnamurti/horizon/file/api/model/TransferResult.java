package com.krishnamurti.horizon.file.api.model;

import java.util.Objects;

public record TransferResult(TransferDisposition disposition, FileSnapshot file) {
    public TransferResult {
        Objects.requireNonNull(disposition);
        Objects.requireNonNull(file);
    }
}
