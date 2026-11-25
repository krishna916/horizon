package com.krishnamurti.horizon.file.application.port;

import java.io.IOException;
import java.io.InputStream;
import java.util.Objects;
import java.util.concurrent.atomic.AtomicBoolean;

/** Provider response stream. Callers own and must close it. */
public final class StoredObject implements AutoCloseable {
    private final InputStream content;
    private final long contentLength;
    private final String contentType;
    private final AtomicBoolean closed = new AtomicBoolean();

    public StoredObject(InputStream content, long contentLength, String contentType) {
        this.content = Objects.requireNonNull(content, "content");
        if (contentLength < 0) {
            throw new IllegalArgumentException("contentLength must not be negative");
        }
        if (contentType == null || contentType.isBlank()) {
            throw new IllegalArgumentException("contentType must not be blank");
        }
        this.contentLength = contentLength;
        this.contentType = contentType;
    }

    public InputStream content() {
        if (closed.get()) {
            throw new IllegalStateException("Stored object is closed");
        }
        return content;
    }

    public long contentLength() {
        return contentLength;
    }

    public String contentType() {
        return contentType;
    }

    @Override
    public void close() throws IOException {
        if (closed.compareAndSet(false, true)) {
            content.close();
        }
    }
}
