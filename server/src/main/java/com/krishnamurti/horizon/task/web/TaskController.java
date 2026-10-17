package com.krishnamurti.horizon.task.web;

import com.krishnamurti.horizon.task.application.TaskCommandService;
import com.krishnamurti.horizon.task.application.TaskQueryService;
import jakarta.validation.Valid;
import java.net.URI;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/** Resource-oriented HTTP operations for authenticated task access. */
@RestController
@RequestMapping("/api/v1/tasks")
public class TaskController {

    private final TaskCommandService taskCommandService;
    private final TaskQueryService taskQueryService;
    private final TaskResponseMapper taskResponseMapper;
    private final TaskRequestMapper taskRequestMapper;

    public TaskController(
            TaskCommandService taskCommandService,
            TaskQueryService taskQueryService,
            TaskResponseMapper taskResponseMapper,
            TaskRequestMapper taskRequestMapper) {
        this.taskCommandService = taskCommandService;
        this.taskQueryService = taskQueryService;
        this.taskResponseMapper = taskResponseMapper;
        this.taskRequestMapper = taskRequestMapper;
    }

    @PostMapping
    public ResponseEntity<TaskDetailResponse> create(
            @Valid @RequestBody CreateTaskRequest request) {
        var task =
                taskCommandService.create(
                        request.title(),
                        request.description(),
                        taskRequestMapper.parsePriority(request.priority()),
                        taskRequestMapper.parseDueDate(request.dueDate()));
        URI location = URI.create("/api/v1/tasks/" + task.getId());
        return ResponseEntity.created(location).body(taskResponseMapper.toDetail(task));
    }

    @GetMapping("/{id}")
    public TaskDetailResponse get(@PathVariable Long id) {
        return taskResponseMapper.toDetail(taskQueryService.get(id));
    }

    @PatchMapping("/{id}")
    public TaskDetailResponse update(
            @PathVariable Long id, @RequestBody UpdateTaskRequest request) {
        return taskResponseMapper.toDetail(
                taskCommandService.update(id, taskRequestMapper.toPatch(request)));
    }

    @GetMapping
    @ResponseStatus(HttpStatus.OK)
    public TaskListResponse list() {
        List<TaskSummaryResponse> items =
                taskQueryService.list().stream().map(taskResponseMapper::toSummary).toList();
        return new TaskListResponse(items);
    }
}
