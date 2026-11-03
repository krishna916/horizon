package com.krishnamurti.horizon.task.web;

import com.krishnamurti.horizon.task.application.IdempotentTaskCreationService;
import com.krishnamurti.horizon.task.application.TaskChecklistQueryService;
import com.krishnamurti.horizon.task.application.TaskCommandService;
import com.krishnamurti.horizon.task.application.TaskQueryService;
import com.krishnamurti.horizon.task.application.TaskTagQueryService;
import com.krishnamurti.horizon.task.domain.Task;
import jakarta.validation.Valid;
import java.net.URI;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/** Resource-oriented HTTP operations for authenticated task access. */
@RestController
@RequestMapping("/api/v1/tasks")
public class TaskController {

    private final TaskCommandService taskCommandService;
    private final IdempotentTaskCreationService idempotentTaskCreationService;
    private final TaskQueryService taskQueryService;
    private final TaskChecklistQueryService taskChecklistQueryService;
    private final TaskTagQueryService taskTagQueryService;
    private final TaskResponseMapper taskResponseMapper;
    private final TaskRequestMapper taskRequestMapper;

    public TaskController(
            TaskCommandService taskCommandService,
            IdempotentTaskCreationService idempotentTaskCreationService,
            TaskQueryService taskQueryService,
            TaskChecklistQueryService taskChecklistQueryService,
            TaskTagQueryService taskTagQueryService,
            TaskResponseMapper taskResponseMapper,
            TaskRequestMapper taskRequestMapper) {
        this.taskCommandService = taskCommandService;
        this.idempotentTaskCreationService = idempotentTaskCreationService;
        this.taskQueryService = taskQueryService;
        this.taskChecklistQueryService = taskChecklistQueryService;
        this.taskTagQueryService = taskTagQueryService;
        this.taskResponseMapper = taskResponseMapper;
        this.taskRequestMapper = taskRequestMapper;
    }

    @PostMapping
    public ResponseEntity<TaskDetailResponse> create(
            @RequestHeader(name = "Idempotency-Key", required = false) String idempotencyKey,
            @Valid @RequestBody CreateTaskRequest request) {
        UUID requestKey = parseIdempotencyKey(idempotencyKey);
        var priority = taskRequestMapper.parsePriority(request.priority());
        var dueDate = taskRequestMapper.parseDueDate(request.dueDate());
        var checklist = taskRequestMapper.parseChecklist(request.checklist());
        var tags = taskRequestMapper.parseTags(request.tags());
        var task =
                requestKey == null
                        ? taskCommandService.create(
                                request.title(),
                                request.description(),
                                priority,
                                dueDate,
                                checklist,
                                tags)
                        : idempotentTaskCreationService.create(
                                requestKey,
                                request.title(),
                                request.description(),
                                priority,
                                dueDate,
                                checklist,
                                tags);
        URI location = URI.create("/api/v1/tasks/" + task.getId());
        return ResponseEntity.created(location).body(toDetail(task));
    }

    private UUID parseIdempotencyKey(String value) {
        if (value == null) {
            return null;
        }
        try {
            UUID requestKey = UUID.fromString(value);
            if (!requestKey.toString().equalsIgnoreCase(value)) {
                throw new IllegalArgumentException("UUID must use the canonical format.");
            }
            return requestKey;
        } catch (IllegalArgumentException exception) {
            throw new TaskRequestValidationException("Idempotency-Key", "Must be a valid UUID.");
        }
    }

    @GetMapping("/{id}")
    public TaskDetailResponse get(@PathVariable Long id) {
        return toDetail(taskQueryService.get(id));
    }

    @PatchMapping("/{id}")
    public TaskDetailResponse update(
            @PathVariable Long id, @RequestBody UpdateTaskRequest request) {
        return toDetail(taskCommandService.update(id, taskRequestMapper.toPatch(request)));
    }

    @PostMapping("/{id}/complete")
    public TaskDetailResponse complete(@PathVariable Long id) {
        return toDetail(taskCommandService.complete(id));
    }

    @PostMapping("/{id}/reopen")
    public TaskDetailResponse reopen(@PathVariable Long id) {
        return toDetail(taskCommandService.reopen(id));
    }

    @PostMapping("/{id}/archive")
    public TaskDetailResponse archive(@PathVariable Long id) {
        return toDetail(taskCommandService.archive(id));
    }

    @PostMapping("/{id}/restore")
    public TaskDetailResponse restoreArchived(@PathVariable Long id) {
        return toDetail(taskCommandService.restoreArchived(id));
    }

    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void softDelete(@PathVariable Long id) {
        taskCommandService.softDelete(id);
    }

    @PostMapping("/{id}/restore-deleted")
    public TaskDetailResponse restoreDeleted(@PathVariable Long id) {
        return toDetail(taskCommandService.restoreDeleted(id));
    }

    @GetMapping
    @ResponseStatus(HttpStatus.OK)
    public TaskListResponse list() {
        List<Task> tasks = taskQueryService.list();
        var tagsByTask =
                tasks.isEmpty()
                        ? java.util.Map
                                .<Long, List<com.krishnamurti.horizon.tag.api.TagReference>>of()
                        : taskTagQueryService.tagsForTasks(
                                tasks.get(0).getUserId(), tasks.stream().map(Task::getId).toList());
        List<TaskSummaryResponse> items =
                tasks.stream()
                        .map(
                                task ->
                                        taskResponseMapper.toSummary(
                                                task, tagsByTask.get(task.getId())))
                        .toList();
        return new TaskListResponse(items);
    }

    private TaskDetailResponse toDetail(Task task) {
        var tags = taskTagQueryService.tagsForTasks(task.getUserId(), List.of(task.getId()));
        return taskResponseMapper.toDetail(
                task,
                taskChecklistQueryService.list(task.getId()),
                tags.getOrDefault(task.getId(), List.of()));
    }
}
