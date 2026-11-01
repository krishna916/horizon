package com.krishnamurti.horizon.tag.domain;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;

class TagNamePolicyTest {

    @Test
    void normalizesRequiredNamesUsingExistingTagRules() {
        assertThat(TagNamePolicy.normalizeRequiredName("  Horizon  ")).isEqualTo("Horizon");
        assertThat(TagNamePolicy.normalizeRequiredName("\u00a0Horizon\u00a0")).isEqualTo("Horizon");
        assertThat(TagNamePolicy.normalizeRequiredName("A B")).isEqualTo("A B");
        assertThat(TagNamePolicy.normalizeRequiredName("😀".repeat(100))).hasSize(200);
    }

    @Test
    void suggestionPrefixAllowsBlankButSharesNameValidation() {
        assertThat(TagNamePolicy.normalizeSuggestionPrefix("  ")).isEmpty();
        assertThat(TagNamePolicy.normalizeSuggestionPrefix("\u00a0Horizon\u00a0"))
                .isEqualTo("Horizon");
        assertThat(TagNamePolicy.normalizeSuggestionPrefix("😀".repeat(100))).hasSize(200);
    }

    @Test
    void rejectsNullBlankControlAndOverlongValues() {
        for (String value : new String[] {null, "", "   ", "\nName", "Name\t", "Line\nBreak"}) {
            assertThatThrownBy(() -> TagNamePolicy.normalizeRequiredName(value))
                    .isInstanceOf(InvalidTagException.class);
        }

        for (String value : new String[] {null, "\t", "Name\n", "😀".repeat(101)}) {
            assertThatThrownBy(() -> TagNamePolicy.normalizeSuggestionPrefix(value))
                    .isInstanceOf(InvalidTagException.class);
        }

        assertThatThrownBy(() -> TagNamePolicy.normalizeRequiredName("😀".repeat(101)))
                .isInstanceOf(InvalidTagException.class);
    }
}
