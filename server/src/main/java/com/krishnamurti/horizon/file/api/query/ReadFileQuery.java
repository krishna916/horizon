package com.krishnamurti.horizon.file.api.query;

import com.krishnamurti.horizon.file.api.model.FileReference;
import java.util.Objects;

public record ReadFileQuery(FileReference file) {
    public ReadFileQuery {
        Objects.requireNonNull(file);
    }
}
