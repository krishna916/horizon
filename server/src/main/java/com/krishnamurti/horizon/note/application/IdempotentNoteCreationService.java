package com.krishnamurti.horizon.note.application;

import com.krishnamurti.horizon.note.domain.Note;
import com.krishnamurti.horizon.note.infrastructure.NoteCreationReceipt;
import com.krishnamurti.horizon.note.infrastructure.NoteCreationRequestRepository;
import com.krishnamurti.horizon.note.infrastructure.NoteRepository;
import com.krishnamurti.horizon.shared.security.CurrentUserProvider;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.security.authentication.InsufficientAuthenticationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Coordinates a Note creation and its idempotency receipt in one transaction. */
@Service
public class IdempotentNoteCreationService {

    private final CurrentUserProvider currentUserProvider;
    private final NoteCreationRequestRepository requestRepository;
    private final NoteRepository noteRepository;
    private final NoteCommandService commandService;
    private final NoteTagQueryService noteTagQueryService;

    public IdempotentNoteCreationService(
            CurrentUserProvider currentUserProvider,
            NoteCreationRequestRepository requestRepository,
            NoteRepository noteRepository,
            NoteCommandService commandService,
            NoteTagQueryService noteTagQueryService) {
        this.currentUserProvider = currentUserProvider;
        this.requestRepository = requestRepository;
        this.noteRepository = noteRepository;
        this.commandService = commandService;
        this.noteTagQueryService = noteTagQueryService;
    }

    @Transactional
    public Note create(UUID requestKey, String title, Map<String, Object> content) {
        return create(requestKey, title, content, List.of());
    }

    @Transactional
    public Note create(
            UUID requestKey,
            String title,
            Map<String, Object> content,
            List<NoteTagSelection> tags) {
        return createWithTags(requestKey, title, content, tags).note();
    }

    @Transactional
    public NoteCreationResult createWithTags(
            UUID requestKey,
            String title,
            Map<String, Object> content,
            List<NoteTagSelection> tags) {
        if (requestKey == null) {
            throw new IllegalArgumentException("Idempotency-Key is required");
        }
        Long userId =
                currentUserProvider
                        .getCurrentUserId()
                        .orElseThrow(
                                () ->
                                        new InsufficientAuthenticationException(
                                                "User is not authenticated"));
        Note normalized = Note.create(userId, title, content);
        String fingerprint =
                NoteCreationFingerprint.compute(
                        normalized.getTitle(), normalized.getContent(), tags);

        if (requestRepository.claim(userId, requestKey, fingerprint)) {
            Note created = commandService.create(title, content, tags);
            requestRepository.complete(userId, requestKey, created.getId());
            return withTags(userId, created, tags);
        }

        NoteCreationReceipt receipt =
                requestRepository
                        .find(userId, requestKey)
                        .orElseThrow(NoteCreationConflictException::new);
        if (!fingerprint.equals(receipt.fingerprint()) || receipt.noteId() == null) {
            throw new NoteCreationConflictException();
        }
        Note replayed =
                noteRepository
                        .findByIdAndUserIdAndDeletedAtIsNull(receipt.noteId(), userId)
                        .orElseThrow(NoteCreationConflictException::new);
        return withTags(userId, replayed, tags);
    }

    private NoteCreationResult withTags(Long userId, Note note, List<NoteTagSelection> selections) {
        if (selections.isEmpty()) {
            return new NoteCreationResult(note, List.of());
        }
        return new NoteCreationResult(
                note,
                noteTagQueryService
                        .tagsForNotes(userId, List.of(note.getId()))
                        .getOrDefault(note.getId(), List.of()));
    }
}
