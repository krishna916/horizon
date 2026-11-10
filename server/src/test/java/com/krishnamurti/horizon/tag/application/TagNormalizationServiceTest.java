package com.krishnamurti.horizon.tag.application;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.krishnamurti.horizon.tag.domain.InvalidTagException;
import org.junit.jupiter.api.Test;

class TagNormalizationServiceTest {

    private final TagNormalizationService normalizationService = new TagNormalizationService();

    @Test
    void normalizationMatchesSharedTagNamePolicy() {
        assertThat(normalizationService.normalizeName("\u2003Work\u00a0")).isEqualTo("Work");
        assertThatThrownBy(() -> normalizationService.normalizeName("bad\nname"))
                .isInstanceOf(InvalidTagException.class);
        assertThatThrownBy(() -> normalizationService.normalizeName("x".repeat(101)))
                .isInstanceOf(InvalidTagException.class);
    }
}
