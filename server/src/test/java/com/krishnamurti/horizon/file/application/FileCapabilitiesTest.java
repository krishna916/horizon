package com.krishnamurti.horizon.file.application;

import static org.assertj.core.api.Assertions.assertThat;

import com.krishnamurti.horizon.file.api.model.FileFormat;
import com.krishnamurti.horizon.file.infrastructure.FileProperties;
import java.util.Set;
import org.junit.jupiter.api.Test;
import org.springframework.util.unit.DataSize;

class FileCapabilitiesTest {

    @Test
    void policyExposesSupportedFormatsAndEffectiveLimit() {
        FileProperties properties = new FileProperties();
        properties.setMaxFileSize(DataSize.ofBytes(50_000_000));

        var policy = new DefaultFileCapabilities(properties).getUploadPolicy();

        assertThat(policy.maxFileSizeBytes()).isEqualTo(50_000_000);
        assertThat(policy.supportedFormats()).containsExactlyInAnyOrder(FileFormat.values());
        assertThat(policy.supportedFormats()).isEqualTo(Set.of(FileFormat.values()));
    }
}
