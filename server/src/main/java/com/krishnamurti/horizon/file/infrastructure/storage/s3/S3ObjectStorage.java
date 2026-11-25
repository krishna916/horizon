package com.krishnamurti.horizon.file.infrastructure.storage.s3;

import com.krishnamurti.horizon.file.application.port.DeleteResult;
import com.krishnamurti.horizon.file.application.port.ObjectKey;
import com.krishnamurti.horizon.file.application.port.ObjectMetadata;
import com.krishnamurti.horizon.file.application.port.ObjectStorage;
import com.krishnamurti.horizon.file.application.port.ObjectStorageException;
import com.krishnamurti.horizon.file.application.port.ObjectWriteRequest;
import com.krishnamurti.horizon.file.application.port.StoredObject;
import com.krishnamurti.horizon.file.application.port.WriteResult;
import java.io.IOException;
import java.nio.file.Files;
import java.util.Objects;
import software.amazon.awssdk.core.ResponseInputStream;
import software.amazon.awssdk.core.sync.RequestBody;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.DeleteObjectRequest;
import software.amazon.awssdk.services.s3.model.GetObjectRequest;
import software.amazon.awssdk.services.s3.model.GetObjectResponse;
import software.amazon.awssdk.services.s3.model.HeadBucketRequest;
import software.amazon.awssdk.services.s3.model.HeadObjectRequest;
import software.amazon.awssdk.services.s3.model.PutObjectRequest;
import software.amazon.awssdk.services.s3.model.S3Exception;

/** S3-compatible storage implementation. PUT uses a separate no-retry SDK client. */
public final class S3ObjectStorage implements ObjectStorage, AutoCloseable {
    private final S3Client writeClient;
    private final S3Client readClient;
    private final String bucket;
    private final AutoCloseable ownedClients;

    public S3ObjectStorage(S3Client writeClient, S3Client readClient, String bucket) {
        this(writeClient, readClient, bucket, null);
    }

    S3ObjectStorage(
            S3Client writeClient, S3Client readClient, String bucket, AutoCloseable ownedClients) {
        this.writeClient = Objects.requireNonNull(writeClient);
        this.readClient = Objects.requireNonNull(readClient);
        if (bucket == null || bucket.isBlank())
            throw new IllegalArgumentException("bucket must not be blank");
        this.bucket = bucket;
        this.ownedClients = ownedClients;
    }

    @Override
    public WriteResult put(ObjectWriteRequest request) {
        Objects.requireNonNull(request);
        try {
            if (!Files.isRegularFile(request.stagedPath())
                    || Files.size(request.stagedPath()) != request.contentLength()) {
                return WriteResult.FAILED_SETTLED;
            }
        } catch (IOException e) {
            return WriteResult.FAILED_SETTLED;
        }
        try {
            writeClient.putObject(
                    PutObjectRequest.builder()
                            .bucket(bucket)
                            .key(request.key().value())
                            .contentLength(request.contentLength())
                            .contentType(request.contentType())
                            .build(),
                    RequestBody.fromFile(request.stagedPath()));
            return WriteResult.ACKNOWLEDGED;
        } catch (S3Exception e) {
            return isSettledClientRejection(e) ? WriteResult.FAILED_SETTLED : WriteResult.UNKNOWN;
        } catch (RuntimeException e) {
            return WriteResult.UNKNOWN;
        }
    }

    @Override
    public ObjectMetadata head(ObjectKey key) {
        Objects.requireNonNull(key);
        try {
            var response =
                    readClient.headObject(
                            HeadObjectRequest.builder().bucket(bucket).key(key.value()).build());
            return new ObjectMetadata(
                    true, response.contentLength(), contentType(response.contentType()));
        } catch (S3Exception e) {
            if (isMissingKey(e)) return ObjectMetadata.missing();
            throw new ObjectStorageException("S3 HEAD failed", e);
        } catch (RuntimeException e) {
            throw new ObjectStorageException("S3 HEAD failed", e);
        }
    }

    @Override
    public StoredObject get(ObjectKey key) {
        Objects.requireNonNull(key);
        try {
            ResponseInputStream<GetObjectResponse> response =
                    readClient.getObject(
                            GetObjectRequest.builder().bucket(bucket).key(key.value()).build());
            return new StoredObject(
                    response,
                    response.response().contentLength(),
                    contentType(response.response().contentType()));
        } catch (S3Exception e) {
            throw new ObjectStorageException("S3 GET failed", e);
        } catch (RuntimeException e) {
            throw new ObjectStorageException("S3 GET failed", e);
        }
    }

    @Override
    public DeleteResult delete(ObjectKey key) {
        Objects.requireNonNull(key);
        try {
            writeClient.deleteObject(
                    DeleteObjectRequest.builder().bucket(bucket).key(key.value()).build());
            return DeleteResult.ACKNOWLEDGED;
        } catch (RuntimeException e) {
            throw new ObjectStorageException("S3 DELETE failed", e);
        }
    }

    @Override
    public void checkAvailability() {
        try {
            readClient.headBucket(HeadBucketRequest.builder().bucket(bucket).build());
        } catch (RuntimeException e) {
            throw new ObjectStorageException("S3 availability check failed", e);
        }
    }

    private static String contentType(String value) {
        return value == null || value.isBlank() ? "application/octet-stream" : value;
    }

    private static boolean isMissingKey(S3Exception e) {
        if (e.statusCode() != 404) return false;
        String errorCode = e.awsErrorDetails() == null ? null : e.awsErrorDetails().errorCode();
        return errorCode == null || !"NoSuchBucket".equalsIgnoreCase(errorCode);
    }

    private static boolean isSettledClientRejection(S3Exception e) {
        int status = e.statusCode();
        return status >= 400 && status < 500 && status != 408 && status != 429;
    }

    @Override
    public void close() {
        if (ownedClients != null) {
            try {
                ownedClients.close();
            } catch (Exception e) {
                throw new ObjectStorageException("Could not close S3 client resources", e);
            }
        }
    }
}
