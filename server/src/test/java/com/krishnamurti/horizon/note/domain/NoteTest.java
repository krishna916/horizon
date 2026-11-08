package com.krishnamurti.horizon.note.domain;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

class NoteTest {

    @Test
    void titleOnlyCreationTrimsAndNormalizesBlankTitleToNull() {
        Note note = Note.create(41L, "  Meeting notes  ", null);

        assertThat(note.getTitle()).isEqualTo("Meeting notes");
        assertThat(note.getUserId()).isEqualTo(41L);
        assertThat(note.isInbox()).isFalse();
        assertThat(note.getArchivedAt()).isNull();
        assertThat(note.getDeletedAt()).isNull();
        assertThat(Note.create(41L, "   ", bodyDocument()).getTitle()).isNull();
    }

    @Test
    void titleLengthUsesJavaCharactersAndPreservesInternalSpacing() {
        assertThat(Note.create(41L, "x".repeat(255), null).getTitle()).hasSize(255);
        assertThat(Note.create(41L, "  project   notes  ", null).getTitle())
                .isEqualTo("project   notes");

        assertThatThrownBy(() -> Note.create(41L, "x".repeat(256), null))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void titleNormalizationTrimsUnicodeSpaceCharactersAndKeepsInternalSpaces() {
        assertThat(Note.create(41L, "\u00a0\u00a0", bodyDocument()).getTitle()).isNull();
        assertThat(Note.create(41L, "\u2003Research\u00a0", null).getTitle()).isEqualTo("Research");
        assertThat(Note.create(41L, "left\u00a0right", null).getTitle())
                .isEqualTo("left\u00a0right");
        assertThat(Note.create(41L, "\u00a0" + "x".repeat(255) + "\u2003", null).getTitle())
                .hasSize(255);
        assertThatThrownBy(() -> Note.create(41L, "\u00a0" + "x".repeat(256) + "\u2003", null))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> Note.create(41L, "\u00a0", null))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void emptyTitleAndContentCannotCreateAndDisplayFallbackIsNeverPersisted() {
        assertThatThrownBy(() -> Note.create(41L, null, null))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> Note.create(41L, " ", emptyDocument()))
                .isInstanceOf(IllegalArgumentException.class);
        assertThat(Note.create(41L, null, bodyDocument()).getTitle()).isNull();
    }

    @Test
    void existingTitleOnlyNoteCanBeClearedWithoutChangingIdentityOrOwner() {
        Note note = Note.create(41L, "  Keep this  ", null);
        Long originalId = note.getId();

        note.updateTitle(null);

        assertThat(note.getTitle()).isNull();
        assertThat(note.getId()).isEqualTo(originalId);
        assertThat(note.getUserId()).isEqualTo(41L);
    }

    @Test
    void bodyOnlyAndIntentionalStructuralContentCanCreate() {
        Note bodyOnly = Note.create(41L, null, doc(paragraph(text("Body"))));
        Note tableOnly = Note.create(41L, null, doc(table()));
        Note ruleOnly = Note.create(41L, null, doc(Map.of("type", "horizontalRule")));

        assertThat(bodyOnly.getContent()).isNotNull();
        assertThat(tableOnly.getContent()).isNotNull();
        assertThat(ruleOnly.getContent()).isNotNull();
        assertThatThrownBy(() -> Note.create(41L, null, doc(paragraph())))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void existingNoteCanClearContentAndTitleTogether() {
        Note note = Note.create(41L, "Title", doc(paragraph(text("Body"))));

        note.updateTitle(null);
        note.updateContent(null);

        assertThat(note.getTitle()).isNull();
        assertThat(note.getContent()).isNull();
    }

    private static Map<String, Object> doc(Map<String, Object>... blocks) {
        return Map.of("type", "doc", "content", List.of(blocks));
    }

    private static Map<String, Object> emptyDocument() {
        return Map.of("type", "doc", "content", List.of());
    }

    private static Map<String, Object> bodyDocument() {
        return doc(paragraph(text("Body")));
    }

    private static Map<String, Object> paragraph(Map<String, Object>... children) {
        return Map.of("type", "paragraph", "content", List.of(children));
    }

    private static Map<String, Object> text(String value) {
        return Map.of("type", "text", "text", value);
    }

    private static Map<String, Object> table() {
        return Map.of(
                "type",
                "table",
                "content",
                List.of(
                        Map.of(
                                "type",
                                "tableRow",
                                "content",
                                List.of(
                                        Map.of(
                                                "type",
                                                "tableCell",
                                                "content",
                                                List.of(
                                                        Map.of(
                                                                "type",
                                                                "paragraph",
                                                                "content",
                                                                List.of())))))));
    }
}
