package com.krishnamurti.horizon.note.application;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.krishnamurti.horizon.note.domain.Note;
import com.krishnamurti.horizon.note.infrastructure.NoteCreationReceipt;
import com.krishnamurti.horizon.note.infrastructure.NoteCreationRequestRepository;
import com.krishnamurti.horizon.note.infrastructure.NoteRepository;
import com.krishnamurti.horizon.shared.security.CurrentUserProvider;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class IdempotentNoteCreationServiceTest {

    @Mock private CurrentUserProvider currentUserProvider;
    @Mock private NoteCreationRequestRepository requestRepository;
    @Mock private NoteRepository noteRepository;
    @Mock private NoteCommandService commandService;
    @Mock private NoteTagQueryService noteTagQueryService;

    private IdempotentNoteCreationService service;

    @BeforeEach
    void setUp() {
        service =
                new IdempotentNoteCreationService(
                        currentUserProvider,
                        requestRepository,
                        noteRepository,
                        commandService,
                        noteTagQueryService);
        when(currentUserProvider.getCurrentUserId()).thenReturn(Optional.of(12L));
    }

    @Test
    void firstRequestCreatesAndCompletesReceipt() {
        UUID key = UUID.randomUUID();
        Map<String, Object> content = body("new note");
        Note created = mock(Note.class);
        when(created.getId()).thenReturn(73L);
        when(requestRepository.claim(eq(12L), eq(key), any())).thenReturn(true);
        when(commandService.create(" Title ", content, List.of())).thenReturn(created);
        when(noteTagQueryService.tagsForNotes(12L, List.of(73L))).thenReturn(Map.of());

        Note result = service.create(key, " Title ", content);

        assertThat(result).isSameAs(created);
        verify(requestRepository).complete(12L, key, 73L);
    }

    @Test
    void matchingRetryReturnsExistingOwnerNoteWithoutCreatingAnother() {
        UUID key = UUID.randomUUID();
        Map<String, Object> content = body("retry");
        String fingerprint = NoteCreationFingerprint.compute("Title", content);
        Note existing = mock(Note.class);
        when(existing.getId()).thenReturn(81L);
        when(requestRepository.claim(12L, key, fingerprint)).thenReturn(false);
        when(requestRepository.find(12L, key))
                .thenReturn(Optional.of(new NoteCreationReceipt(fingerprint, 81L)));
        when(noteRepository.findByIdAndUserIdAndDeletedAtIsNull(81L, 12L))
                .thenReturn(Optional.of(existing));
        when(noteTagQueryService.tagsForNotes(12L, List.of(81L))).thenReturn(Map.of());

        assertThat(service.create(key, " Title ", content)).isSameAs(existing);
        verify(commandService, never()).create(any(), any(), anyList());
    }

    @Test
    void changedPayloadAndMissingReplayTargetConflict() {
        UUID key = UUID.randomUUID();
        Map<String, Object> original = body("original");
        String fingerprint = NoteCreationFingerprint.compute("Title", original);
        when(requestRepository.claim(eq(12L), eq(key), any())).thenReturn(false);
        when(requestRepository.find(12L, key))
                .thenReturn(Optional.of(new NoteCreationReceipt(fingerprint, 81L)));

        assertThatThrownBy(() -> service.create(key, "Title", body("changed")))
                .isInstanceOf(NoteCreationConflictException.class);
        assertThatThrownBy(() -> service.create(key, "Title", original))
                .isInstanceOf(NoteCreationConflictException.class);
        verify(noteRepository).findByIdAndUserIdAndDeletedAtIsNull(81L, 12L);
    }

    @Test
    void invalidEmptyCreateDoesNotClaimReceipt() {
        UUID key = UUID.randomUUID();

        assertThatThrownBy(
                        () -> service.create(key, " ", Map.of("type", "doc", "content", List.of())))
                .isInstanceOf(IllegalArgumentException.class);

        verify(requestRepository, never()).claim(eq(12L), eq(key), any());
    }

    private static Map<String, Object> body(String text) {
        return Map.of(
                "type",
                "doc",
                "content",
                List.of(
                        Map.of(
                                "type",
                                "paragraph",
                                "content",
                                List.of(Map.of("type", "text", "text", text)))));
    }
}
