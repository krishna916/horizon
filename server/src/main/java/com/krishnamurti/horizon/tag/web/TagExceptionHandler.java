package com.krishnamurti.horizon.tag.web;

import com.krishnamurti.horizon.tag.api.InvalidTagNameException;
import java.net.URI;
import java.util.Map;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestControllerAdvice;

/** Problem Details mapping for the Tag suggestions query. */
@RestControllerAdvice(assignableTypes = TagController.class)
@Order(Ordered.HIGHEST_PRECEDENCE)
public class TagExceptionHandler {

    @ExceptionHandler({TagRequestValidationException.class, InvalidTagNameException.class})
    @ResponseStatus(HttpStatus.BAD_REQUEST)
    public ProblemDetail handleInvalidSuggestionQuery(RuntimeException exception) {
        ProblemDetail detail = ProblemDetail.forStatus(HttpStatus.BAD_REQUEST);
        detail.setTitle("Validation Failed");
        detail.setDetail("The suggestions query contains an invalid value.");
        detail.setInstance(URI.create("/api/v1/tags/suggestions"));
        detail.setProperty("errors", Map.of("q", exception.getMessage()));
        return detail;
    }
}
