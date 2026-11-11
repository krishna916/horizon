package com.krishnamurti.horizon.tag.application;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.krishnamurti.horizon.tag.api.InvalidTagNameException;
import org.junit.jupiter.api.Test;

class TagNormalizationServiceTest {

    private final TagNormalizationService normalizationService = new TagNormalizationService();

    @Test
    void normalizationMatchesSharedTagNamePolicy() {
        assertThat(normalizationService.normalizeName("\u2003Work\u00a0")).isEqualTo("Work");
        assertThatThrownBy(() -> normalizationService.normalizeName("bad\nname"))
                .isInstanceOf(InvalidTagNameException.class);
        String tooLongName = "x".repeat(101);
        assertThatThrownBy(() -> normalizationService.normalizeName(tooLongName))
                .isInstanceOf(InvalidTagNameException.class);
    }
}
