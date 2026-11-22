package com.krishnamurti.horizon.poc.s3;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;

import java.security.MessageDigest;
import java.util.HexFormat;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestInstance;
import software.amazon.awssdk.core.sync.RequestBody;
import software.amazon.awssdk.services.s3.model.GetObjectRequest;
import software.amazon.awssdk.services.s3.model.PutObjectRequest;

@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class S3PersistenceTest {

    private S3Environment environment;

    @BeforeAll
    void startEnvironment() throws Exception {
        java.util.TimeZone.setDefault(java.util.TimeZone.getTimeZone("UTC"));
        environment = S3Environment.start();
    }

    @AfterAll
    void closeEnvironment() {
        if (environment != null) environment.close();
    }

    @Test
    void A07_objectSurvivesContainerRecreationOnTheSameNamedVolume() throws Exception {
        String key = environment.newObjectKey("A07-persistence");
        byte[] payload = environment.deterministicBytes("A07-persistence", 1_000_003);
        String expectedSha256 = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(payload));
        environment.directClient().putObject(
                PutObjectRequest.builder().bucket(environment.bucket()).key(key).build(), RequestBody.fromBytes(payload));

        environment.recreateSeaweedfsContainer();

        byte[] restored = environment.directClient().getObjectAsBytes(
                GetObjectRequest.builder().bucket(environment.bucket()).key(key).build()).asByteArray();
        assertEquals(expectedSha256, HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(restored)));
        assertArrayEquals(payload, restored);
        String volumeName = System.getenv().getOrDefault("POC_S3_VOLUME", "horizon-issue75-s3-compat-data");
        ProofEvidence.record(environment.runId(), "A07", "container removed/recreated with named volume " + volumeName + "; GET preserved " + restored.length + " bytes sha256=" + expectedSha256);
    }
}
