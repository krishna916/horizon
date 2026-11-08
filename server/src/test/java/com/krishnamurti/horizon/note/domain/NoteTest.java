package com.krishnamurti.horizon.note.domain;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

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
        assertThat(Note.create(41L, "   ", Map.of("type", "doc")).getTitle()).isNull();
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
    void emptyTitleAndContentCannotCreateAndDisplayFallbackIsNeverPersisted() {
        assertThatThrownBy(() -> Note.create(41L, null, null))
                .isInstanceOf(IllegalArgumentException.class);
        assertThat(Note.create(41L, null, Map.of("type", "doc")).getTitle()).isNull();
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
}
