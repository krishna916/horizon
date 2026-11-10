package com.krishnamurti.horizon.note.infrastructure;

import com.krishnamurti.horizon.note.domain.Note;
import jakarta.persistence.LockModeType;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/** Persistence operations for Notes, always scoped by the owning user for reads. */
public interface NoteRepository extends JpaRepository<Note, Long> {

    Optional<Note> findByIdAndUserIdAndDeletedAtIsNull(Long id, Long userId);

    Optional<Note> findByIdAndUserId(Long id, Long userId);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query(
            "select note from Note note where note.id = :noteId and note.userId = :userId"
                    + " and note.deletedAt is null")
    Optional<Note> lockOwnedForTagWrite(@Param("noteId") Long noteId, @Param("userId") Long userId);
}
