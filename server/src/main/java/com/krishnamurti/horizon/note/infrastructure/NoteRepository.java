package com.krishnamurti.horizon.note.infrastructure;

import com.krishnamurti.horizon.note.domain.Note;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

/** Persistence operations for Notes, always scoped by the owning user for reads. */
public interface NoteRepository extends JpaRepository<Note, Long> {

    Optional<Note> findByIdAndUserIdAndDeletedAtIsNull(Long id, Long userId);

    Optional<Note> findByIdAndUserId(Long id, Long userId);
}
