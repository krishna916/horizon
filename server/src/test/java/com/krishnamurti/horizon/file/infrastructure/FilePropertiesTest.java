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
    void recoveryDefaultsMatchApprovedValues() {
        var recovery = new FileProperties().getRecovery();
        assertThat(recovery.isEnabled()).isTrue();
        assertThat(recovery.getPollInterval()).isEqualTo(java.time.Duration.ofSeconds(30));
        assertThat(recovery.getBatchSize()).isEqualTo(25);
        assertThat(recovery.getLeaseDuration()).isEqualTo(java.time.Duration.ofMinutes(10));
        assertThat(recovery.getInitialRetryDelay()).isEqualTo(java.time.Duration.ofSeconds(30));
        assertThat(recovery.getMaxRetryDelay()).isEqualTo(java.time.Duration.ofHours(1));
        assertThat(recovery.getUnknownRevisitInterval()).isEqualTo(java.time.Duration.ofHours(1));
    }

    @Test
    void rejectsInvalidRecoveryDurationsAndBatch() {
        FileProperties p = new FileProperties();
        p.getRecovery().setBatchSize(0);
        assertThatThrownBy(p::validate).isInstanceOf(IllegalStateException.class);
        p.getRecovery().setBatchSize(1);
        p.getRecovery().setPollInterval(java.time.Duration.ZERO);
        assertThatThrownBy(p::validate).isInstanceOf(IllegalStateException.class);
        p.getRecovery().setPollInterval(java.time.Duration.ofSeconds(1));
        p.getRecovery().setInitialRetryDelay(java.time.Duration.ofHours(2));
        assertThatThrownBy(p::validate).isInstanceOf(IllegalStateException.class);
    }

    @Test
    void leaseMustExceedDeleteTimeoutPlusMargin() {
        FileProperties p = new FileProperties();
        p.getRecovery().setLeaseDuration(java.time.Duration.ofSeconds(330));
        assertThatThrownBy(p::validate).isInstanceOf(IllegalStateException.class);
        p.getRecovery().setLeaseDuration(java.time.Duration.ofSeconds(331));
        p.validate();
    }

    @Test
    void bindsRecoveryOverrides() {
        var source =
                new SystemEnvironmentPropertySource(
                        "systemEnvironment",
                        java.util.Map.of(
                                "HORIZON_FILE_RECOVERY_ENABLED", "false",
                                "HORIZON_FILE_RECOVERY_POLL_INTERVAL", "17s",
                                "HORIZON_FILE_RECOVERY_BATCH_SIZE", "7"));
        FileProperties p =
                new Binder(ConfigurationPropertySources.from(source))
                        .bind("horizon.file", FileProperties.class)
                        .get();
        assertThat(p.getRecovery().isEnabled()).isFalse();
        assertThat(p.getRecovery().getPollInterval()).isEqualTo(java.time.Duration.ofSeconds(17));
        assertThat(p.getRecovery().getBatchSize()).isEqualTo(7);
    }

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
