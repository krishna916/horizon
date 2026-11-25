package com.krishnamurti.horizon.file.infrastructure;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;
import org.springframework.boot.context.properties.bind.Binder;
import org.springframework.boot.context.properties.source.MapConfigurationPropertySource;
import org.springframework.util.unit.DataSize;

class FilePropertiesTest {

    @Test
    void defaultsPreserveStrictTwentyMiB() {
        FileProperties properties = new FileProperties();
        assertThat(properties.getMaxFileSizeBytes()).isEqualTo(20_971_519L);
        assertThat(properties.getUnclaimedExpiry()).isEqualTo(java.time.Duration.ofHours(24));
        assertThat(properties.getStaging().getMaxConcurrentTransfers()).isEqualTo(4);
        assertThat(properties.getStaging().getCopyBufferSize()).isEqualTo(65_536);
        assertThat(
                        properties
                                .getStaging()
                                .effectiveMaxTotalSizeBytes(properties.getMaxFileSizeBytes()))
                .isEqualTo(83_886_076L);
    }

    @Test
    void supportsEnvironmentStyleOverrideAndInclusiveCeiling() {
        MapConfigurationPropertySource source = new MapConfigurationPropertySource();
        source.put("horizon.file.max-file-size", DataSize.ofMegabytes(50));
        FileProperties overridden =
                new Binder(source).bind("horizon.file", FileProperties.class).get();
        assertThat(overridden.getMaxFileSizeBytes()).isEqualTo(52_428_800L);

        FileProperties ceiling = new FileProperties();
        ceiling.setMaxFileSize(DataSize.ofBytes(FileProperties.HARD_MAX_FILE_SIZE_BYTES));
        ceiling.validate();
        assertThat(ceiling.getMaxFileSizeBytes()).isEqualTo(104_857_600L);
    }

    @Test
    void rejectsLimitAboveCeilingAndCapacityBelowOneFile() {
        FileProperties tooLarge = new FileProperties();
        tooLarge.setMaxFileSize(DataSize.ofBytes(FileProperties.HARD_MAX_FILE_SIZE_BYTES + 1));
        assertThatThrownBy(tooLarge::validate).isInstanceOf(IllegalStateException.class);

        FileProperties tooSmallCapacity = new FileProperties();
        tooSmallCapacity.getStaging().setMaxTotalSize(DataSize.ofBytes(1));
        assertThatThrownBy(tooSmallCapacity::validate).isInstanceOf(IllegalStateException.class);
    }
}
