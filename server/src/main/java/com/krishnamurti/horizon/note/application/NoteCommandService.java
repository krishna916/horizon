package com.krishnamurti.horizon.note.application;

import com.krishnamurti.horizon.note.domain.Note;
import com.krishnamurti.horizon.note.infrastructure.NoteRepository;
import com.krishnamurti.horizon.shared.security.CurrentUserProvider;
import edu.umd.cs.findbugs.annotations.SuppressFBWarnings;
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
    private final NoteTagAssignmentService noteTagAssignmentService;

    @SuppressFBWarnings(
            value = "EI_EXPOSE_REP2",
            justification =
                    "The injected collaborators are private final Spring-managed dependencies.")
    public NoteCommandService(
            NoteRepository noteRepository,
            CurrentUserProvider currentUserProvider,
            NoteTagAssignmentService noteTagAssignmentService) {
        this.noteRepository = noteRepository;
        this.currentUserProvider = currentUserProvider;
        this.noteTagAssignmentService = noteTagAssignmentService;
    }

    @Transactional
    public Note create(String title, Map<String, Object> content) {
        return create(title, content, java.util.List.of());
    }

    @Transactional
    public Note create(
            String title, Map<String, Object> content, java.util.List<NoteTagSelection> tags) {
        Long userId =
                currentUserProvider
                        .getCurrentUserId()
                        .orElseThrow(
                                () ->
                                        new InsufficientAuthenticationException(
                                                "User is not authenticated"));
        Note note = noteRepository.saveAndFlush(Note.create(userId, title, content));
        if (!tags.isEmpty()) {
            noteTagAssignmentService.replace(userId, note.getId(), tags);
        }
        return note;
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
                        .lockOwnedForTagWrite(noteId, userId)
                        .orElseThrow(() -> new NoteNotFoundException(noteId));
        if (note.getVersion() != patch.expectedVersion()) {
            throw new NoteVersionConflictException();
        }

        String originalTitle = note.getTitle();
        Map<String, Object> originalContent = note.getContent();
        boolean tagsChanged =
                patch.tags().present()
                        && noteTagAssignmentService.replace(userId, noteId, patch.tags().value());
        if (patch.title().present()) {
            note.updateTitle(patch.title().value());
        }
        if (patch.content().present()) {
            note.updateContent(patch.content().value());
        }
        boolean fieldsChanged =
                !Objects.equals(originalTitle, note.getTitle())
                        || !Objects.equals(originalContent, note.getContent());
        if (tagsChanged) {
            note.touchMetadata();
        }
        if (!fieldsChanged && !tagsChanged) {
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
