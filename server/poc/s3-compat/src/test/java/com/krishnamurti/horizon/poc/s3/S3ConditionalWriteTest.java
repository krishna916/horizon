package com.krishnamurti.horizon.poc.s3;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestInstance;
import software.amazon.awssdk.core.sync.RequestBody;
import software.amazon.awssdk.services.s3.model.GetObjectRequest;
import software.amazon.awssdk.services.s3.model.PutObjectRequest;
import software.amazon.awssdk.services.s3.model.S3Exception;

@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class S3ConditionalWriteTest {

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
    void A08_ifNoneMatchStarPreservesTheFirstObject() throws Exception {
        String key = environment.newObjectKey("A08-conditional");
        byte[] first = environment.deterministicBytes("A08-first", 16384);
        byte[] second = environment.deterministicBytes("A08-second", 16384);
        environment.directClient().putObject(
                PutObjectRequest.builder().bucket(environment.bucket()).key(key).ifNoneMatch("*").build(), RequestBody.fromBytes(first));

        S3Exception rejected = assertThrows(
                S3Exception.class,
                () -> environment.directClient().putObject(
                        PutObjectRequest.builder().bucket(environment.bucket()).key(key).ifNoneMatch("*").build(), RequestBody.fromBytes(second)));
        assertTrue(rejected.statusCode() == 409 || rejected.statusCode() == 412, "unexpected conditional-write status " + rejected.statusCode());
        assertArrayEquals(first, environment.directClient().getObjectAsBytes(
                GetObjectRequest.builder().bucket(environment.bucket()).key(key).build()).asByteArray());
        ProofEvidence.record(environment.runId(), "A08", "SDK If-None-Match: * accepted first PUT, rejected second with HTTP " + rejected.statusCode() + ", first payload remained intact");
    }

    @Test
    void A09_concurrentConditionalPutsHaveExactlyOneVisibleWinner() throws Exception {
        for (int trial = 0; trial < 5; trial++) {
            String key = environment.newObjectKey("A09-race-" + trial);
            byte[] first = environment.deterministicBytes("A09-first-" + trial, 32771);
            byte[] second = environment.deterministicBytes("A09-second-" + trial, 32771);
            CountDownLatch ready = new CountDownLatch(2);
            CountDownLatch start = new CountDownLatch(1);
            try (var executor = Executors.newFixedThreadPool(2)) {
                var outcomes = new ArrayList<java.util.concurrent.Future<byte[]>>();
                for (byte[] payload : List.of(first, second)) {
                    outcomes.add(executor.submit(() -> {
                        ready.countDown();
                        if (!start.await(5, TimeUnit.SECONDS)) throw new IllegalStateException("start barrier timed out");
                        try {
                            environment.directClient().putObject(
                                    PutObjectRequest.builder().bucket(environment.bucket()).key(key).ifNoneMatch("*").build(), RequestBody.fromBytes(payload));
                            return payload;
                        } catch (S3Exception e) {
                            if (e.statusCode() != 409 && e.statusCode() != 412) throw e;
                            return null;
                        }
                    }));
                }
                assertTrue(ready.await(5, TimeUnit.SECONDS));
                start.countDown();
                var results = outcomes.stream().map(future -> {
                    try { return future.get(10, TimeUnit.SECONDS); }
                    catch (Exception e) { throw new IllegalStateException(e); }
                }).toList();
                assertEquals(1, results.stream().filter(java.util.Objects::nonNull).count());
                byte[] visible = environment.directClient().getObjectAsBytes(
                        GetObjectRequest.builder().bucket(environment.bucket()).key(key).build()).asByteArray();
                assertTrue(java.util.Arrays.equals(first, visible) || java.util.Arrays.equals(second, visible));
                assertArrayEquals(results.stream().filter(java.util.Objects::nonNull).findFirst().orElseThrow(), visible);
            }
        }
        ProofEvidence.record(environment.runId(), "A09", "five barrier-synchronized races each produced exactly one accepted conditional PUT and one complete matching visible payload");
    }
}
