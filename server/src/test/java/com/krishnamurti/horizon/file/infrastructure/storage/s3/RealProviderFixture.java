package com.krishnamurti.horizon.file.infrastructure.storage.s3;

import com.krishnamurti.horizon.file.infrastructure.FileProperties;
import java.net.URI;
import software.amazon.awssdk.auth.credentials.AwsBasicCredentials;
import software.amazon.awssdk.auth.credentials.StaticCredentialsProvider;
import software.amazon.awssdk.services.s3.model.CreateBucketRequest;
import software.amazon.awssdk.services.s3.model.ListObjectsV2Request;
import software.amazon.awssdk.services.s3.model.ListObjectsV2Response;
import software.amazon.awssdk.services.s3.model.S3Exception;

/**
 * Test-only access to authenticated provider operations that are intentionally absent in
 * ObjectStorage.
 */
public final class RealProviderFixture implements AutoCloseable {
    private final S3Configuration.Clients clients;
    private final String bucket;
    private final S3ObjectStorage storage;

    private RealProviderFixture(S3Configuration.Clients clients, String bucket) {
        this.clients = clients;
        this.bucket = bucket;
        this.storage = new S3ObjectStorage(clients.write(), clients.read(), bucket);
    }

    public static RealProviderFixture connect(
            URI endpoint, String bucket, String accessKey, String secretKey) {
        FileProperties properties = new FileProperties();
        var s3 = properties.getStorage().getS3();
        s3.setEndpoint(endpoint.toString());
        s3.setBucket(bucket);
        s3.setPathStyleAccess(true);
        s3.setOperationTimeout(java.time.Duration.ofSeconds(8));
        s3.setSocketTimeout(java.time.Duration.ofSeconds(5));
        var credentials =
                StaticCredentialsProvider.create(AwsBasicCredentials.create(accessKey, secretKey));
        S3Configuration.Clients clients = S3Configuration.createClients(s3, credentials);
        ensureBucket(clients, bucket);
        return new RealProviderFixture(clients, bucket);
    }

    private static void ensureBucket(S3Configuration.Clients clients, String bucket) {
        try {
            clients.read().headBucket(request -> request.bucket(bucket));
        } catch (S3Exception exception) {
            if (exception.statusCode() != 404) throw exception;
            clients.write().createBucket(CreateBucketRequest.builder().bucket(bucket).build());
        }
    }

    public S3ObjectStorage storage() {
        return storage;
    }

    public ListObjectsV2Response listObjects() {
        return clients.read().listObjectsV2(ListObjectsV2Request.builder().bucket(bucket).build());
    }

    @Override
    public void close() {
        storage.close();
        clients.close();
    }
}
