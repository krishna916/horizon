package com.krishnamurti.horizon.file.application.port;

/** Private object storage boundary; implementations must not expose provider types here. */
public interface ObjectStorage {
    WriteResult put(ObjectWriteRequest request);

    ObjectMetadata head(ObjectKey key);

    StoredObject get(ObjectKey key);

    DeleteResult delete(ObjectKey key);

    /** Performs an authenticated, read-only provider availability check. */
    void checkAvailability();
}
