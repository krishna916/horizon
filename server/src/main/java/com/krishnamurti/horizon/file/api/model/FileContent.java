package com.krishnamurti.horizon.file.api.model;

import java.io.IOException;
import java.io.InputStream;
import java.util.Objects;

public record FileContent(FileMetadata metadata, InputStream stream) implements AutoCloseable {
    public FileContent {
        Objects.requireNonNull(metadata);
        Objects.requireNonNull(stream);
    }

    @Override
    public void close() throws IOException {
        stream.close();
    }
}
