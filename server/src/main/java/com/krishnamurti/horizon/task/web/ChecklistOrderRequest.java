package com.krishnamurti.horizon.task.web;

import java.util.List;

/** Exact ordered active sibling IDs submitted for a checklist reorder. */
public record ChecklistOrderRequest(List<Long> itemIds) {}
