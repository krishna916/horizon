package com.krishnamurti.horizon.file.api.model;

public enum FileLifecycle {
    PREPARED,
    VERIFIED,
    CLAIMED,
    EXPIRED,
    CLEANUP_REQUESTED,
    PURGED
}
