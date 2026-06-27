package com.krishnamurti.horizon.shared.web;

import java.util.HashMap;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.validation.FieldError;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestControllerAdvice;

/**
 * Global exception handler that converts exceptions to RFC 9457 Problem Details.
 *
 * <p>Centralizes error responses across all controllers. Each handler maps a specific exception
 * type to an appropriate HTTP status and ProblemDetail representation.
 */
@RestControllerAdvice
public class GlobalExceptionHandler {

    @ExceptionHandler(EmailAlreadyRegisteredException.class)
    @ResponseStatus(HttpStatus.CONFLICT)
    public ProblemDetail handleEmailAlreadyRegistered(EmailAlreadyRegisteredException ex) {
        ProblemDetail detail = ProblemDetail.forStatus(HttpStatus.CONFLICT);
        detail.setTitle("Email Already Registered");
        detail.setDetail("A user with this email address already exists.");
        return detail;
    }

    @ExceptionHandler(InvalidCredentialsException.class)
    @ResponseStatus(HttpStatus.UNAUTHORIZED)
    public ProblemDetail handleInvalidCredentials(InvalidCredentialsException ex) {
        ProblemDetail detail = ProblemDetail.forStatus(HttpStatus.UNAUTHORIZED);
        detail.setTitle("Invalid Credentials");
        detail.setDetail("The email address or password provided is incorrect.");
        return detail;
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    @ResponseStatus(HttpStatus.BAD_REQUEST)
    public ProblemDetail handleValidation(MethodArgumentNotValidException ex) {
        ProblemDetail detail = ProblemDetail.forStatus(HttpStatus.BAD_REQUEST);
        detail.setTitle("Validation Failed");
        detail.setDetail("The request body contains invalid fields.");

        Map<String, String> errors = new HashMap<>();
        for (FieldError fieldError : ex.getBindingResult().getFieldErrors()) {
            errors.put(fieldError.getField(), fieldError.getDefaultMessage());
        }
        detail.setProperty("errors", errors);

        return detail;
    }

    @ExceptionHandler(org.springframework.http.converter.HttpMessageNotReadableException.class)
    @ResponseStatus(HttpStatus.BAD_REQUEST)
    public ProblemDetail handleHttpMessageNotReadable(
            org.springframework.http.converter.HttpMessageNotReadableException ex) {
        ProblemDetail detail = ProblemDetail.forStatus(HttpStatus.BAD_REQUEST);
        detail.setTitle("Malformed JSON Request");
        detail.setDetail("The request body is missing or could not be parsed.");
        return detail;
    }

    @ExceptionHandler(org.springframework.web.servlet.resource.NoResourceFoundException.class)
    @ResponseStatus(HttpStatus.NOT_FOUND)
    public ProblemDetail handleNoResourceFound(
            org.springframework.web.servlet.resource.NoResourceFoundException ex) {
        ProblemDetail detail = ProblemDetail.forStatus(HttpStatus.NOT_FOUND);
        detail.setTitle("Resource Not Found");
        detail.setDetail(ex.getMessage());
        return detail;
    }

    @ExceptionHandler(Exception.class)
    @ResponseStatus(HttpStatus.INTERNAL_SERVER_ERROR)
    public ProblemDetail handleUnexpectedException(Exception ex) {
        ProblemDetail detail = ProblemDetail.forStatus(HttpStatus.INTERNAL_SERVER_ERROR);
        detail.setTitle("Internal Server Error");
        detail.setDetail("An unexpected error occurred. Please try again later.");
        return detail;
    }
}
