package com.krishnamurti.horizon.file.api.command;

import com.krishnamurti.horizon.file.api.model.FileDescriptor;
import com.krishnamurti.horizon.file.api.model.FileScope;
import java.util.Objects;
import java.util.UUID;

public record PrepareFileCommand(UUID idempotencyKey, FileScope scope, FileDescriptor descriptor) {
    public PrepareFileCommand {
        Objects.requireNonNull(idempotencyKey);
        Objects.requireNonNull(scope);
        Objects.requireNonNull(descriptor);
    }
}
