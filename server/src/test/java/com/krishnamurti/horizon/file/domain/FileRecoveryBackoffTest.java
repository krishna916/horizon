package com.krishnamurti.horizon.file.domain;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Duration;
import org.junit.jupiter.api.Test;

class FileRecoveryBackoffTest {
    @Test
    void equalJitterBoundsForFirstAndCappedRetry() {
        assertThat(
                        FileRecoveryBackoff.delay(
                                Duration.ofSeconds(30), Duration.ofHours(1), 1, () -> 0))
                .isEqualTo(Duration.ofSeconds(15));
        assertThat(
                        FileRecoveryBackoff.delay(
                                Duration.ofSeconds(30), Duration.ofHours(1), 2, () -> 0))
                .isEqualTo(Duration.ofSeconds(30));
        assertThat(
                        FileRecoveryBackoff.delay(
                                Duration.ofSeconds(30), Duration.ofHours(1), 8, () -> 0))
                .isEqualTo(Duration.ofMinutes(30));
        assertThat(
                        FileRecoveryBackoff.delay(
                                Duration.ofSeconds(30), Duration.ofHours(1), 8, () -> 0.999))
                .isLessThan(Duration.ofHours(1));
    }

    @Test
    void saturatesWithoutOverflowForLongMax() {
        assertThat(
                        FileRecoveryBackoff.delay(
                                Duration.ofSeconds(30),
                                Duration.ofHours(1),
                                Long.MAX_VALUE,
                                () -> 0))
                .isEqualTo(Duration.ofMinutes(30));
    }

    @Test
    void rejectsNonPositiveInputs() {
        assertThatThrownBy(
                        () ->
                                FileRecoveryBackoff.delay(
                                        Duration.ZERO, Duration.ofSeconds(1), 1, () -> 0))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(
                        () ->
                                FileRecoveryBackoff.delay(
                                        Duration.ofSeconds(1), Duration.ofSeconds(1), 0, () -> 0))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void positiveConfiguredDelayCannotRoundDownToZero() {
        assertThat(
                        FileRecoveryBackoff.delay(
                                Duration.ofNanos(1), Duration.ofSeconds(1), 1, () -> 0))
                .isPositive();
    }
}
