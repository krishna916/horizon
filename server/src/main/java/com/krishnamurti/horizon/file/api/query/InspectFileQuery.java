package com.krishnamurti.horizon.file.api.query;

import com.krishnamurti.horizon.file.api.model.FileReference;
import java.util.Objects;

public record InspectFileQuery(FileReference file) {
    public InspectFileQuery {
        Objects.requireNonNull(file);
    }
}
