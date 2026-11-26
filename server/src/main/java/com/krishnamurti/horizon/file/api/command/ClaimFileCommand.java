package com.krishnamurti.horizon.file.api.command;

import com.krishnamurti.horizon.file.api.model.FileReference;
import java.util.Objects;

public record ClaimFileCommand(FileReference file) {
    public ClaimFileCommand {
        Objects.requireNonNull(file);
    }
}
