package com.krishnamurti.horizon.file.application.port;

/** Provider-neutral confirmation that a requested object is absent. */
public final class ObjectNotFoundException extends ObjectStorageException {
    public ObjectNotFoundException(String message, Throwable cause) {
        super(message, cause);
    }
}
