package com.krishnamurti.horizon.file.application.port;

/** Outcome of a single object PUT. UNKNOWN must retain its locator for later verification. */
public enum WriteResult {
    ACKNOWLEDGED,
    FAILED_SETTLED,
    UNKNOWN
}
