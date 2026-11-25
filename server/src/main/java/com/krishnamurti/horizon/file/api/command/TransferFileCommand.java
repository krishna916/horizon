package com.krishnamurti.horizon.file.api.command;

import com.krishnamurti.horizon.file.api.model.FileReference;
import java.io.InputStream;
import java.util.Objects;

public record TransferFileCommand(FileReference file, long contentLength, InputStream content) {
    public TransferFileCommand {
        Objects.requireNonNull(file);
        Objects.requireNonNull(content);
        if (contentLength <= 0) {
            throw new IllegalArgumentException("contentLength must be positive");
        }
    }
}
