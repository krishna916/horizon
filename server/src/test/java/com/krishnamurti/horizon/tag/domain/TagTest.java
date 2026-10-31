package com.krishnamurti.horizon.tag.domain;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatNullPointerException;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;

class TagTest {

    @Test
    void createTrimsAndPreservesDisplayCasing() {
        Tag tag = Tag.create(7L, "  Horizon  ");

        assertThat(tag.getUserId()).isEqualTo(7L);
        assertThat(tag.getName()).isEqualTo("Horizon");
        assertThat(Tag.create(7L, "Research  Notes").getName()).isEqualTo("Research  Notes");
    }

    @Test
    void acceptsUnicodeAndSymbols() {
        assertThat(Tag.create(7L, "C++").getName()).isEqualTo("C++");
        assertThat(Tag.create(7L, "@work").getName()).isEqualTo("@work");
        assertThat(Tag.create(7L, "Café").getName()).isEqualTo("Café");
        assertThat(Tag.create(7L, "日本語").getName()).isEqualTo("日本語");
    }

    @Test
    void rejectsInvalidNamesAndTrimsUnicodeEdgeSpaces() {
        for (String name :
                new String[] {null, "", "   ", "\nName", "Name\t", "Line\nBreak", "\u0000"}) {
            assertThatThrownBy(() -> Tag.create(7L, name))
                    .isInstanceOf(InvalidTagException.class)
                    .extracting("field")
                    .isEqualTo("name");
        }

        assertThat(Tag.create(7L, "\u00a0Horizon\u00a0").getName()).isEqualTo("Horizon");
        assertThatNullPointerException().isThrownBy(() -> Tag.create(null, "Horizon"));
    }

    @Test
    void limitsNameTo100CodePointsAfterTrimming() {
        assertThat(Tag.create(7L, "a".repeat(100)).getName()).hasSize(100);
        assertThat(Tag.create(7L, "😀".repeat(100)).getName().codePointCount(0, 200))
                .isEqualTo(100);
        assertThat(Tag.create(7L, " " + "a".repeat(100) + " ").getName()).hasSize(100);

        assertThatThrownBy(() -> Tag.create(7L, "a".repeat(101)))
                .isInstanceOf(InvalidTagException.class);
        assertThatThrownBy(() -> Tag.create(7L, "😀".repeat(101)))
                .isInstanceOf(InvalidTagException.class);
    }
}
