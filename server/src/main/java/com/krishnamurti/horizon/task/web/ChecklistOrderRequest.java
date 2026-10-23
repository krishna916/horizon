package com.krishnamurti.horizon.task.web;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/** Exact ordered active sibling IDs submitted for a checklist reorder. */
public record ChecklistOrderRequest(List<Long> itemIds) {

    public ChecklistOrderRequest {
        itemIds = itemIds == null ? null : Collections.unmodifiableList(new ArrayList<>(itemIds));
    }
}
