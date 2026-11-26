package com.krishnamurti.horizon.file.api.command;

import com.krishnamurti.horizon.file.api.model.FileReference;
import java.util.Objects;

public record CleanupFileCommand(FileReference file) {
    public CleanupFileCommand {
        Objects.requireNonNull(file);
    }
}
