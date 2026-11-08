package com.krishnamurti.horizon.note.application;

import com.krishnamurti.horizon.note.domain.Note;
import com.krishnamurti.horizon.note.infrastructure.NoteRepository;
import com.krishnamurti.horizon.shared.security.CurrentUserProvider;
import java.util.Map;
import java.util.Objects;
import org.springframework.orm.ObjectOptimisticLockingFailureException;
import org.springframework.security.authentication.InsufficientAuthenticationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Transactional Note mutation use cases. */
@Service
public class NoteCommandService {

    private final NoteRepository noteRepository;
    private final CurrentUserProvider currentUserProvider;

    public NoteCommandService(
            NoteRepository noteRepository, CurrentUserProvider currentUserProvider) {
        this.noteRepository = noteRepository;
        this.currentUserProvider = currentUserProvider;
    }

    @Transactional
    public Note create(String title, Map<String, Object> content) {
        Long userId =
                currentUserProvider
                        .getCurrentUserId()
                        .orElseThrow(
                                () ->
                                        new InsufficientAuthenticationException(
                                                "User is not authenticated"));
        return noteRepository.saveAndFlush(Note.create(userId, title, content));
    }

    @Transactional
    public Note update(Long noteId, NotePatch patch) {
        Long userId =
                currentUserProvider
                        .getCurrentUserId()
                        .orElseThrow(
                                () ->
                                        new InsufficientAuthenticationException(
                                                "User is not authenticated"));
        Note note =
                noteRepository
                        .findByIdAndUserIdAndDeletedAtIsNull(noteId, userId)
                        .orElseThrow(() -> new NoteNotFoundException(noteId));
        if (note.getVersion() != patch.expectedVersion()) {
            throw new NoteVersionConflictException();
        }

        String originalTitle = note.getTitle();
        Map<String, Object> originalContent = note.getContent();
        if (patch.title().present()) {
            note.updateTitle(patch.title().value());
        }
        if (patch.content().present()) {
            note.updateContent(patch.content().value());
        }
        if (Objects.equals(originalTitle, note.getTitle())
                && Objects.equals(originalContent, note.getContent())) {
            return note;
        }
        try {
            return noteRepository.saveAndFlush(note);
        } catch (ObjectOptimisticLockingFailureException
                | jakarta.persistence.OptimisticLockException exception) {
            throw new NoteVersionConflictException();
        }
    }
}
