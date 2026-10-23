package com.krishnamurti.horizon.task.web;

import com.krishnamurti.horizon.task.application.TaskChecklistCommandService;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/** Task-scoped HTTP commands for checklist items. */
@RestController
@RequestMapping("/api/v1/tasks/{taskId}/checklist-items")
public class TaskChecklistController {

    private final TaskChecklistCommandService commandService;
    private final TaskChecklistRequestMapper requestMapper;

    public TaskChecklistController(
            TaskChecklistCommandService commandService, TaskChecklistRequestMapper requestMapper) {
        this.commandService = commandService;
        this.requestMapper = requestMapper;
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public ChecklistItemResponse add(
            @PathVariable Long taskId, @Valid @RequestBody AddChecklistItemRequest request) {
        return ChecklistItemResponse.from(
                commandService.add(taskId, requestMapper.toAddTitle(request)));
    }

    @PatchMapping("/{itemId}")
    public ChecklistItemResponse patch(
            @PathVariable Long taskId,
            @PathVariable Long itemId,
            @RequestBody UpdateChecklistItemRequest request) {
        return ChecklistItemResponse.from(
                commandService.patch(taskId, itemId, requestMapper.toPatch(request)));
    }

    @PostMapping("/{itemId}/complete")
    public ChecklistItemResponse complete(@PathVariable Long taskId, @PathVariable Long itemId) {
        return ChecklistItemResponse.from(commandService.complete(taskId, itemId));
    }

    @PostMapping("/{itemId}/reopen")
    public ChecklistItemResponse reopen(@PathVariable Long taskId, @PathVariable Long itemId) {
        return ChecklistItemResponse.from(commandService.reopen(taskId, itemId));
    }

    @PutMapping("/order")
    public java.util.List<ChecklistItemResponse> reorder(
            @PathVariable Long taskId, @RequestBody ChecklistOrderRequest request) {
        return commandService.reorder(taskId, request.itemIds()).stream()
                .map(ChecklistItemResponse::from)
                .toList();
    }

    @DeleteMapping("/{itemId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void remove(@PathVariable Long taskId, @PathVariable Long itemId) {
        commandService.remove(taskId, itemId);
    }

    @PostMapping("/{itemId}/restore")
    public ChecklistItemResponse restore(@PathVariable Long taskId, @PathVariable Long itemId) {
        return ChecklistItemResponse.from(commandService.restore(taskId, itemId));
    }
}
