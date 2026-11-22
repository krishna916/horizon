package com.krishnamurti.horizon.poc.s3;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestInstance;
import software.amazon.awssdk.core.exception.SdkException;
import software.amazon.awssdk.services.s3.model.DeleteObjectRequest;
import software.amazon.awssdk.services.s3.model.GetObjectRequest;
import software.amazon.awssdk.services.s3.model.HeadObjectRequest;
import software.amazon.awssdk.services.s3.model.ListBucketsRequest;
import software.amazon.awssdk.services.s3.model.ListObjectsV2Request;
import software.amazon.awssdk.services.s3.model.PutObjectRequest;
import software.amazon.awssdk.core.sync.RequestBody;
import software.amazon.awssdk.services.s3.model.S3Exception;

@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class S3BasicCompatibilityTest {

    private S3Environment environment;

    @BeforeAll
    void startEnvironment() throws Exception {
        java.util.TimeZone.setDefault(java.util.TimeZone.getTimeZone("UTC"));
        environment = S3Environment.start();
    }

    @AfterAll
    void closeEnvironment() {
        if (environment != null) {
            environment.close();
        }
    }

    @Test
    void A01_credentialedClientSeesBootstrappedPrivateBucket() {
        boolean bucketExists =
                environment.directClient().listBuckets(ListBucketsRequest.builder().build())
                        .buckets().stream()
                        .anyMatch(bucket -> environment.bucket().equals(bucket.name()));

        assertTrue(bucketExists, "the authenticated S3 bucket should be bootstrapped");
        ProofEvidence.record(environment.runId(), "A01", "authenticated ListBuckets found the configured test bucket");
    }

    @Test
    void A02_wrongCredentialsAndUnsignedReadAreRejected() throws Exception {
        String key = environment.newObjectKey("A02-auth-check");
        byte[] payload = "private-auth-check".getBytes(StandardCharsets.UTF_8);
        environment.directClient().putObject(
                PutObjectRequest.builder().bucket(environment.bucket()).key(key).build(),
                RequestBody.fromBytes(payload));
        try {
            S3Exception wrongCredentialFailure;
            try (var wrongCredentialClient = environment.clientWithCredentials("wrong-access", "wrong-secret")) {
                wrongCredentialFailure =
                        assertThrows(
                                S3Exception.class,
                                () -> wrongCredentialClient.listObjectsV2(
                                        ListObjectsV2Request.builder().bucket(environment.bucket()).build()));
            }
            assertEquals(403, wrongCredentialFailure.statusCode());

            HttpRequest unsignedRead =
                    HttpRequest.newBuilder(URI.create(environment.endpoint() + "/" + environment.bucket() + "/" + key))
                            .GET()
                            .build();
            HttpResponse<Void> unsignedResponse =
                    HttpClient.newBuilder().connectTimeout(java.time.Duration.ofSeconds(3)).build()
                            .send(unsignedRead, HttpResponse.BodyHandlers.discarding());
            assertEquals(403, unsignedResponse.statusCode());
            ProofEvidence.record(environment.runId(), "A02", "wrong-key S3 request and unsigned GET both returned HTTP 403");
        } finally {
            environment.directClient().deleteObject(
                    DeleteObjectRequest.builder().bucket(environment.bucket()).key(key).build());
        }
    }

    @Test
    void A03_putHeadAndGetPreserveExactBytesAndSha256() throws Exception {
        String key = environment.newObjectKey("A03-roundtrip");
        byte[] payload = environment.deterministicBytes("A03-roundtrip", 4097);
        String expectedSha256 = sha256(payload);

        environment.directClient().putObject(
                PutObjectRequest.builder().bucket(environment.bucket()).key(key).contentType("application/octet-stream").build(),
                RequestBody.fromBytes(payload));
        var head = environment.directClient().headObject(
                HeadObjectRequest.builder().bucket(environment.bucket()).key(key).build());
        byte[] downloaded = environment.directClient().getObjectAsBytes(
                GetObjectRequest.builder().bucket(environment.bucket()).key(key).build()).asByteArray();

        assertEquals((long) payload.length, head.contentLength());
        assertTrue(java.util.Arrays.equals(payload, downloaded));
        assertEquals(expectedSha256, sha256(downloaded));
        assertNotEquals(expectedSha256, head.eTag(), "an S3 ETag must not be treated as SHA-256");
        ProofEvidence.record(environment.runId(), "A03", "PUT/HEAD/GET length=" + head.contentLength() + " sha256=" + expectedSha256);
    }

    @Test
    void A06_deleteAndRepeatedDeleteLeaveTheObjectAbsent() {
        String key = environment.newObjectKey("A06-delete");
        environment.directClient().putObject(
                PutObjectRequest.builder().bucket(environment.bucket()).key(key).build(),
                RequestBody.fromBytes("delete-me".getBytes(StandardCharsets.UTF_8)));

        environment.directClient().deleteObject(DeleteObjectRequest.builder().bucket(environment.bucket()).key(key).build());
        environment.directClient().deleteObject(DeleteObjectRequest.builder().bucket(environment.bucket()).key(key).build());

        S3Exception absent =
                assertThrows(
                        S3Exception.class,
                        () -> environment.directClient().headObject(
                                HeadObjectRequest.builder().bucket(environment.bucket()).key(key).build()));
        assertEquals(404, absent.statusCode());
        ProofEvidence.record(environment.runId(), "A06", "two DELETE requests left the key absent; independent HEAD returned HTTP 404");
    }

    @Test
    void A16_missingObjectHeadIsClassifiedAsNotFound() {
        String key = environment.newObjectKey("A16-missing-" + UUID.randomUUID());

        S3Exception missing =
                assertThrows(
                        S3Exception.class,
                        () -> environment.directClient().headObject(
                                HeadObjectRequest.builder().bucket(environment.bucket()).key(key).build()));

        assertEquals(404, missing.statusCode());
        assertFalse(missing.awsErrorDetails() == null || missing.awsErrorDetails().errorCode() == null);
        assertTrue(
                "NoSuchKey".equals(missing.awsErrorDetails().errorCode()),
                "provider error code was " + missing.awsErrorDetails().errorCode());
        ProofEvidence.record(environment.runId(), "A16", "missing HEAD returned HTTP 404 with error code " + missing.awsErrorDetails().errorCode());
    }

    private static String sha256(byte[] value) throws Exception {
        return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value));
    }
}
