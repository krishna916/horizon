package com.krishnamurti.horizon.file.application.port;

/** A provider operation failed without proving that the requested object is absent. */
public class ObjectStorageException extends RuntimeException {
    public ObjectStorageException(String message, Throwable cause) {
        super(message, cause);
    }

    public ObjectStorageException(String message) {
        super(message);
    }
}
