package com.krishnamurti.horizon.task.infrastructure;

import com.krishnamurti.horizon.task.domain.ChecklistItem;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

/** Persistence operations for task-owned checklist items. */
public interface ChecklistItemRepository extends JpaRepository<ChecklistItem, Long> {

    List<ChecklistItem> findAllByTaskIdAndDeletedAtIsNullOrderByPositionAscIdAsc(Long taskId);

    Optional<ChecklistItem> findByIdAndTaskId(Long itemId, Long taskId);

    Optional<ChecklistItem> findByIdAndTaskIdAndDeletedAtIsNull(Long itemId, Long taskId);
}
