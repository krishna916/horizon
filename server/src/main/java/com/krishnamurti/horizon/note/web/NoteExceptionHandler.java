package com.krishnamurti.horizon.note.web;

import com.krishnamurti.horizon.note.application.NoteCreationConflictException;
import com.krishnamurti.horizon.note.application.NoteNotFoundException;
import com.krishnamurti.horizon.note.application.NoteVersionConflictException;
import com.krishnamurti.horizon.note.domain.InvalidNoteException;
import java.net.URI;
import java.util.Map;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestControllerAdvice;

/** Note-specific RFC 9457 Problem Details for validation, conflicts, and owner-safe reads. */
@RestControllerAdvice(assignableTypes = NoteController.class)
@Order(Ordered.HIGHEST_PRECEDENCE)
public class NoteExceptionHandler {

    private static final String NOTES_PATH = "/api/v1/notes";

    @ExceptionHandler(NoteNotFoundException.class)
    @ResponseStatus(HttpStatus.NOT_FOUND)
    public ProblemDetail handleNotFound(NoteNotFoundException exception) {
        ProblemDetail detail = ProblemDetail.forStatus(HttpStatus.NOT_FOUND);
        detail.setTitle("Note Not Found");
        detail.setDetail("The requested Note was not found.");
        detail.setInstance(URI.create(NOTES_PATH));
        return detail;
    }

    @ExceptionHandler({NoteCreationConflictException.class, NoteVersionConflictException.class})
    @ResponseStatus(HttpStatus.CONFLICT)
    public ProblemDetail handleConflict(RuntimeException exception) {
        ProblemDetail detail = ProblemDetail.forStatus(HttpStatus.CONFLICT);
        detail.setTitle("Note Conflict");
        detail.setDetail("The Note request conflicts with the current state.");
        detail.setInstance(URI.create(NOTES_PATH));
        return detail;
    }

    @ExceptionHandler(NoteRequestValidationException.class)
    @ResponseStatus(HttpStatus.BAD_REQUEST)
    public ProblemDetail handleInvalidRequest(NoteRequestValidationException exception) {
        return validationFailure(exception.getField(), exception.getMessage());
    }

    @ExceptionHandler(InvalidNoteException.class)
    @ResponseStatus(HttpStatus.BAD_REQUEST)
    public ProblemDetail handleInvalidNote(InvalidNoteException exception) {
        return validationFailure(exception.getField(), exception.getMessage());
    }

    private ProblemDetail validationFailure(String field, String message) {
        ProblemDetail detail = ProblemDetail.forStatus(HttpStatus.BAD_REQUEST);
        detail.setTitle("Validation Failed");
        detail.setDetail("The Note request contains invalid fields.");
        detail.setInstance(URI.create(NOTES_PATH));
        detail.setProperty("errors", Map.of(field, message));
        return detail;
    }
}
