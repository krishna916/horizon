package com.krishnamurti.horizon.file.application;

import com.krishnamurti.horizon.file.application.port.DeleteResult;
import com.krishnamurti.horizon.file.application.port.ObjectKey;
import com.krishnamurti.horizon.file.application.port.ObjectMetadata;
import com.krishnamurti.horizon.file.application.port.ObjectStorage;
import com.krishnamurti.horizon.file.application.port.ObjectStorageException;
import com.krishnamurti.horizon.file.application.port.ObjectWriteRequest;
import com.krishnamurti.horizon.file.application.port.StoredObject;
import com.krishnamurti.horizon.file.application.port.WriteResult;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.util.Arrays;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.Consumer;

/** Test port for asserting transaction boundaries and deterministic remote outcomes. */
public final class RecordingObjectStorage implements ObjectStorage {
    private final Map<String, StoredBytes> objects = new ConcurrentHashMap<>();
    private final CopyOnWriteArrayList<ObjectWriteRequest> puts = new CopyOnWriteArrayList<>();
    private final AtomicReference<WriteResult> nextPutResult =
            new AtomicReference<>(WriteResult.ACKNOWLEDGED);
    private final AtomicReference<Consumer<ObjectWriteRequest>> putHook = new AtomicReference<>();
    private final AtomicReference<byte[]> getOverride = new AtomicReference<>();
    private final AtomicInteger gets = new AtomicInteger();
    private final AtomicInteger closedReadStreams = new AtomicInteger();
    private final AtomicBoolean storeNextPut = new AtomicBoolean(true);
    private final AtomicBoolean unavailable = new AtomicBoolean();

    @Override
    public WriteResult put(ObjectWriteRequest request) {
        puts.add(request);
        Consumer<ObjectWriteRequest> hook = putHook.get();
        if (hook != null) hook.accept(request);
        try {
            byte[] bytes = Files.readAllBytes(request.stagedPath());
            WriteResult result = nextPutResult.getAndSet(WriteResult.ACKNOWLEDGED);
            if (result != WriteResult.FAILED_SETTLED && storeNextPut.getAndSet(true)) {
                objects.put(request.key().value(), new StoredBytes(bytes, request.contentType()));
            }
            return result;
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    @Override
    public ObjectMetadata head(ObjectKey key) {
        StoredBytes object = objects.get(key.value());
        return object == null
                ? ObjectMetadata.missing()
                : new ObjectMetadata(true, object.bytes().length, object.contentType());
    }

    @Override
    public StoredObject get(ObjectKey key) {
        gets.incrementAndGet();
        StoredBytes object = objects.get(key.value());
        if (object == null) throw new ObjectStorageException("test object missing");
        byte[] override = getOverride.getAndSet(null);
        byte[] bytes = override == null ? object.bytes() : Arrays.copyOf(override, override.length);
        return new StoredObject(
                new ByteArrayInputStream(bytes) {
                    @Override
                    public void close() throws IOException {
                        closedReadStreams.incrementAndGet();
                        super.close();
                    }
                },
                bytes.length,
                object.contentType());
    }

    @Override
    public DeleteResult delete(ObjectKey key) {
        objects.remove(key.value());
        return DeleteResult.ACKNOWLEDGED;
    }

    @Override
    public void checkAvailability() {
        if (unavailable.get()) throw new ObjectStorageException("test storage unavailable");
    }

    public int putCount() {
        return puts.size();
    }

    public int getCount() {
        return gets.get();
    }

    public int closedReadStreamCount() {
        return closedReadStreams.get();
    }

    public void resetReadTracking() {
        gets.set(0);
        closedReadStreams.set(0);
    }

    public void reset() {
        objects.clear();
        puts.clear();
        nextPutResult.set(WriteResult.ACKNOWLEDGED);
        storeNextPut.set(true);
        unavailable.set(false);
        putHook.set(null);
        getOverride.set(null);
        gets.set(0);
        closedReadStreams.set(0);
    }

    public ObjectWriteRequest lastPut() {
        return puts.getLast();
    }

    public void nextPutResult(WriteResult result) {
        nextPutResult.set(result);
    }

    public void doNotStoreNextPut() {
        storeNextPut.set(false);
    }

    public void setUnavailable(boolean value) {
        unavailable.set(value);
    }

    public void putHook(Consumer<ObjectWriteRequest> hook) {
        putHook.set(hook);
    }

    public void nextGetBytes(byte[] bytes) {
        getOverride.set(Arrays.copyOf(bytes, bytes.length));
    }

    private static final class StoredBytes {
        private final byte[] bytes;
        private final String contentType;

        private StoredBytes(byte[] bytes, String contentType) {
            this.bytes = Arrays.copyOf(bytes, bytes.length);
            this.contentType = contentType;
        }

        private byte[] bytes() {
            return Arrays.copyOf(bytes, bytes.length);
        }

        private String contentType() {
            return contentType;
        }
    }
}
