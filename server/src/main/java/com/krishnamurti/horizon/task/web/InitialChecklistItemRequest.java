package com.krishnamurti.horizon.task.web;

import tools.jackson.databind.JsonNode;

/** Checklist child draft nested in task creation JSON. */
public record InitialChecklistItemRequest(String title, JsonNode dueDate) {}
