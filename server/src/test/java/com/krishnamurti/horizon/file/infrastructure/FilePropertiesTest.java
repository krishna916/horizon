package com.krishnamurti.horizon.file.infrastructure;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;
import org.springframework.boot.context.properties.bind.Binder;
import org.springframework.boot.context.properties.source.ConfigurationPropertySources;
import org.springframework.core.env.SystemEnvironmentPropertySource;
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
        SystemEnvironmentPropertySource source =
                new SystemEnvironmentPropertySource(
                        "test-environment", java.util.Map.of("HORIZON_FILE_MAX_FILE_SIZE", "50MB"));
        FileProperties overridden =
                new Binder(ConfigurationPropertySources.from(source))
                        .bind("horizon.file", FileProperties.class)
                        .get();
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

    @Test
    void parserLimitsMatchApprovedBoundsAndCannotBeRaised() {
        FileProperties properties = new FileProperties();
        var validation = properties.getValidation();
        assertThat(validation.getMaxImageWidth()).isEqualTo(8_192);
        assertThat(validation.getMaxImageHeight()).isEqualTo(8_192);
        assertThat(validation.getMaxImagePixels()).isEqualTo(16_000_000L);
        assertThat(validation.getMaxImageFrames()).isEqualTo(100);
        assertThat(validation.getMaxCumulativeImagePixels()).isEqualTo(64_000_000L);
        assertThat(validation.getMaxPdfPages()).isEqualTo(1_000);
        assertThat(validation.getMaxOfficeEntries()).isEqualTo(2_048);
        assertThat(validation.getMaxOfficeEntrySize().toBytes()).isEqualTo(33_554_432L);
        assertThat(validation.getMaxOfficeExpandedSize().toBytes()).isEqualTo(134_217_728L);
        assertThat(validation.getMaxParserScratchSize().toBytes()).isEqualTo(134_217_728L);

        validation.setMaxImagePixels(16_000_001L);
        assertThatThrownBy(properties::validate).isInstanceOf(IllegalStateException.class);
    }

    @Test
    void s3ConfigurationRequiresBoundedOperationSettings() {
        FileProperties missingBucket = new FileProperties();
        missingBucket.getStorage().getS3().setBucket(" ");
        assertThatThrownBy(missingBucket::validate).isInstanceOf(IllegalStateException.class);

        FileProperties invalidRetryCount = new FileProperties();
        invalidRetryCount.getStorage().getS3().setReadMaxAttempts(0);
        assertThatThrownBy(invalidRetryCount::validate).isInstanceOf(IllegalStateException.class);

        FileProperties invalidEndpoint = new FileProperties();
        invalidEndpoint.getStorage().getS3().setEndpoint("file:///tmp/objects");
        assertThatThrownBy(invalidEndpoint::validate).isInstanceOf(IllegalStateException.class);
    }
}
