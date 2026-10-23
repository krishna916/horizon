package com.krishnamurti.horizon.task.infrastructure;

import com.krishnamurti.horizon.task.domain.Task;
import jakarta.persistence.LockModeType;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/** Persistence operations that require the owning user's ID for task access. */
public interface TaskRepository extends JpaRepository<Task, Long> {

    Optional<Task> findByIdAndUserIdAndDeletedAtIsNull(Long id, Long userId);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query(
            "select task from Task task where task.id = :taskId and task.userId = :userId"
                    + " and task.deletedAt is null")
    Optional<Task> lockOwnedForChecklistWrite(
            @Param("taskId") Long taskId, @Param("userId") Long userId);

    List<Task> findAllByUserIdAndDeletedAtIsNullOrderByCreatedAtDescIdDesc(Long userId);
}
