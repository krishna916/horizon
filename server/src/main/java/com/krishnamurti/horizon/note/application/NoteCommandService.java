package com.krishnamurti.horizon.note.application;

import com.krishnamurti.horizon.note.domain.Note;
import com.krishnamurti.horizon.note.infrastructure.NoteRepository;
import com.krishnamurti.horizon.shared.security.CurrentUserProvider;
import java.util.Map;
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
}
