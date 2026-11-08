package com.krishnamurti.horizon.note.web;

import com.krishnamurti.horizon.note.application.IdempotentNoteCreationService;
import com.krishnamurti.horizon.note.application.NoteCommandService;
import com.krishnamurti.horizon.note.application.NoteQueryService;
import java.net.URI;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** Thin HTTP adapter for authenticated Notes core operations. */
@RestController
@RequestMapping("/api/v1/notes")
public class NoteController {

    private final IdempotentNoteCreationService creationService;
    private final NoteQueryService queryService;
    private final NoteCommandService commandService;
    private final NoteRequestMapper requestMapper;
    private final NoteResponseMapper responseMapper;

    public NoteController(
            IdempotentNoteCreationService creationService,
            NoteQueryService queryService,
            NoteCommandService commandService,
            NoteRequestMapper requestMapper,
            NoteResponseMapper responseMapper) {
        this.creationService = creationService;
        this.queryService = queryService;
        this.commandService = commandService;
        this.requestMapper = requestMapper;
        this.responseMapper = responseMapper;
    }

    @PostMapping
    public ResponseEntity<NoteDetailResponse> create(
            @RequestHeader(name = "Idempotency-Key", required = false) String idempotencyKey,
            @RequestBody CreateNoteRequest request) {
        var key = requestMapper.parseIdempotencyKey(idempotencyKey);
        var fields = requestMapper.toCreate(request);
        var note = creationService.create(key, fields.title(), fields.content());
        return ResponseEntity.created(URI.create("/api/v1/notes/" + note.getId()))
                .body(responseMapper.toDetail(note));
    }

    @GetMapping("/{id}")
    public NoteDetailResponse get(@PathVariable Long id) {
        return responseMapper.toDetail(queryService.get(id));
    }

    @PatchMapping("/{id}")
    public NoteDetailResponse update(
            @PathVariable Long id, @RequestBody UpdateNoteRequest request) {
        return responseMapper.toDetail(commandService.update(id, requestMapper.toPatch(request)));
    }

    @GetMapping
    public NoteListResponse list(
            @RequestParam(required = false) String collection,
            @RequestParam(required = false) String page,
            @RequestParam(required = false) String size,
            @RequestParam(required = false) String sort) {
        var parsedCollection = requestMapper.parseCollection(collection);
        var parsedSort = requestMapper.parseSort(sort);
        int parsedPage = requestMapper.parsePage(page, 0, "page", 0, Integer.MAX_VALUE);
        int parsedSize = requestMapper.parsePage(size, 30, "size", 1, 100);
        requestMapper.validateOffset(parsedPage, parsedSize);
        return responseMapper.toList(
                queryService.list(parsedCollection, parsedSort, parsedPage, parsedSize));
    }
}
