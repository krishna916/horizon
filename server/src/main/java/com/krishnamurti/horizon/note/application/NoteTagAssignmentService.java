package com.krishnamurti.horizon.note.application;

import com.krishnamurti.horizon.note.infrastructure.NoteRepository;
import com.krishnamurti.horizon.note.infrastructure.NoteTagAssociationRepository;
import com.krishnamurti.horizon.shared.domain.BaseEntity;
import com.krishnamurti.horizon.tag.api.TagCommandApi;
import com.krishnamurti.horizon.tag.api.TagQueryApi;
import com.krishnamurti.horizon.tag.api.TagReference;
import edu.umd.cs.findbugs.annotations.SuppressFBWarnings;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Objects;
import java.util.Set;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/** Resolves and atomically replaces Note associations through the public Tag API. */
@Service
public class NoteTagAssignmentService {

    private final NoteRepository noteRepository;
    private final NoteTagAssociationRepository associationRepository;
    private final TagQueryApi tagQueryApi;
    private final TagCommandApi tagCommandApi;

    @SuppressFBWarnings(
            value = "EI_EXPOSE_REP2",
            justification =
                    "The injected collaborators are private final Spring-managed dependencies.")
    public NoteTagAssignmentService(
            NoteRepository noteRepository,
            NoteTagAssociationRepository associationRepository,
            TagQueryApi tagQueryApi,
            TagCommandApi tagCommandApi) {
        this.noteRepository = noteRepository;
        this.associationRepository = associationRepository;
        this.tagQueryApi = tagQueryApi;
        this.tagCommandApi = tagCommandApi;
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public boolean replace(Long ownerId, Long noteId, List<NoteTagSelection> selections) {
        Long ownedNoteId =
                noteRepository
                        .lockOwnedForTagWrite(noteId, ownerId)
                        .map(BaseEntity::getId)
                        .orElseThrow(() -> new NoteNotFoundException(noteId));
        Set<Long> resolvedIds = resolve(ownerId, selections);
        Set<Long> currentIds = associationRepository.findTagIdsForNote(ownerId, ownedNoteId);
        if (currentIds.equals(resolvedIds)) {
            return false;
        }

        associationRepository.replace(ownerId, ownedNoteId, resolvedIds);
        return true;
    }

    private Set<Long> resolve(Long ownerId, List<NoteTagSelection> selections) {
        Set<Long> requestedIds = new LinkedHashSet<>();
        selections.stream()
                .map(NoteTagSelection::id)
                .filter(Objects::nonNull)
                .forEach(requestedIds::add);

        if (!requestedIds.isEmpty()
                && tagQueryApi.findAllByIds(ownerId, requestedIds).size() != requestedIds.size()) {
            throw new InvalidNoteTagReferenceException();
        }

        Set<Long> resolvedIds = new LinkedHashSet<>(requestedIds);
        for (NoteTagSelection selection : selections) {
            if (selection.name() != null) {
                TagReference tag = tagCommandApi.resolveByName(ownerId, selection.name());
                resolvedIds.add(tag.id());
            }
        }
        return Set.copyOf(resolvedIds);
    }
}
