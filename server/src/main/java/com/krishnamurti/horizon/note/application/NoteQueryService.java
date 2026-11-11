package com.krishnamurti.horizon.note.application;

import com.krishnamurti.horizon.note.domain.Note;
import com.krishnamurti.horizon.note.infrastructure.NoteCollectionRepository;
import com.krishnamurti.horizon.note.infrastructure.NoteRepository;
import com.krishnamurti.horizon.shared.security.CurrentUserProvider;
import com.krishnamurti.horizon.tag.api.TagReference;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import org.springframework.security.authentication.InsufficientAuthenticationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Owner-scoped Note reads. */
@Service
@Transactional(readOnly = true)
public class NoteQueryService {

    private final NoteRepository noteRepository;
    private final NoteCollectionRepository collectionRepository;
    private final CurrentUserProvider currentUserProvider;
    private final NoteTagQueryService noteTagQueryService;

    public NoteQueryService(
            NoteRepository noteRepository,
            NoteCollectionRepository collectionRepository,
            CurrentUserProvider currentUserProvider,
            NoteTagQueryService noteTagQueryService) {
        this.noteRepository = noteRepository;
        this.collectionRepository = collectionRepository;
        this.currentUserProvider = currentUserProvider;
        this.noteTagQueryService = noteTagQueryService;
    }

    public Note get(Long noteId) {
        Long userId = currentUserId();
        return noteRepository
                .findByIdAndUserIdAndDeletedAtIsNull(noteId, userId)
                .orElseThrow(() -> new NoteNotFoundException(noteId));
    }

    public Map<Long, List<TagReference>> tagsForNotes(Collection<Long> noteIds) {
        if (noteIds.isEmpty()) {
            return Map.of();
        }
        return noteTagQueryService.tagsForNotes(currentUserId(), noteIds);
    }

    /**
     * Returns an offset-paginated slice. Edits between requests can shift rows; that drift is
     * accepted for the V1 Notes browser contract.
     */
    public NotePage list(NoteCollection collection, NoteSort sort, int page, int size) {
        if (collection == null || sort == null) {
            throw new IllegalArgumentException("collection and sort are required");
        }
        if (page < 0 || size < 1 || size > 100) {
            throw new IllegalArgumentException(
                    "page must be nonnegative and size must be between 1 and 100");
        }
        int offset;
        try {
            offset = Math.multiplyExact(page, size);
        } catch (ArithmeticException exception) {
            throw new IllegalArgumentException("page offset is too large", exception);
        }
        Long userId = currentUserId();
        List<Note> fetched =
                collectionRepository.findPage(userId, collection, sort, offset, size + 1);
        boolean hasNext = fetched.size() > size;
        List<Note> items = hasNext ? fetched.subList(0, size) : fetched;
        return new NotePage(items, page, size, hasNext, collectionRepository.countForUser(userId));
    }

    private Long currentUserId() {
        return currentUserProvider
                .getCurrentUserId()
                .orElseThrow(
                        () -> new InsufficientAuthenticationException("User is not authenticated"));
    }
}
