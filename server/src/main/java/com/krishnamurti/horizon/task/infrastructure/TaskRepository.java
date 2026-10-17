package com.krishnamurti.horizon.task.infrastructure;

import com.krishnamurti.horizon.task.domain.Task;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

/** Persistence operations that require the owning user's ID for task access. */
public interface TaskRepository extends JpaRepository<Task, Long> {

    Optional<Task> findByIdAndUserIdAndDeletedAtIsNull(Long id, Long userId);

    List<Task> findAllByUserIdAndDeletedAtIsNullOrderByCreatedAtDescIdDesc(Long userId);
}
