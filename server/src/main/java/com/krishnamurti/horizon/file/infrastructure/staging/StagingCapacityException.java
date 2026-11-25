package com.krishnamurti.horizon.file.infrastructure.staging;

public final class StagingCapacityException extends RuntimeException {
    public StagingCapacityException() {
        super("File staging capacity is temporarily exhausted");
    }
}
