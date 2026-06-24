package com.krishnamurti.horizon.shared.web;

public class InvalidCredentialsException extends RuntimeException {
    public InvalidCredentialsException() {
        super("Invalid email or password.");
    }
}
