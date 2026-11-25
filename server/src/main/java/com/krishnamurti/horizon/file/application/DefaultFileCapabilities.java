package com.krishnamurti.horizon.file.application;

import com.krishnamurti.horizon.file.api.FileCapabilities;
import com.krishnamurti.horizon.file.api.model.FileFormat;
import com.krishnamurti.horizon.file.api.model.FileUploadPolicy;
import com.krishnamurti.horizon.file.infrastructure.FileProperties;
import java.util.Set;
import org.springframework.stereotype.Component;

@Component
public class DefaultFileCapabilities implements FileCapabilities {

    private static final Set<FileFormat> FORMATS = Set.of(FileFormat.values());
    private final FileProperties properties;

    public DefaultFileCapabilities(FileProperties properties) {
        this.properties = properties;
    }

    @Override
    public FileUploadPolicy getUploadPolicy() {
        return new FileUploadPolicy(properties.getMaxFileSizeBytes(), FORMATS);
    }
}
