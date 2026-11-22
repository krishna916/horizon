package com.krishnamurti.horizon.poc.s3;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.net.ServerSocket;
import java.net.URI;
import java.time.Duration;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestInstance;
import software.amazon.awssdk.core.exception.SdkClientException;
import software.amazon.awssdk.core.sync.RequestBody;
import software.amazon.awssdk.services.s3.model.GetObjectRequest;
import software.amazon.awssdk.services.s3.model.PutObjectRequest;

@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class S3FailureTest {

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
    void A10_unavailableEndpointFailsBoundedlyWithoutFalseSuccess() throws Exception {
        int unavailablePort;
        try (ServerSocket socket = new ServerSocket(0)) {
            unavailablePort = socket.getLocalPort();
        }
        String key = environment.newObjectKey("A10-unavailable");
        byte[] payload = environment.deterministicBytes("A10-unavailable", 4096);
        long started = System.nanoTime();
        try (var unavailableClient = environment.clientAt(URI.create("http://127.0.0.1:" + unavailablePort))) {
            assertThrows(SdkClientException.class, () -> unavailableClient.putObject(
                    PutObjectRequest.builder().bucket(environment.bucket()).key(key).build(), RequestBody.fromBytes(payload)));
        }
        long elapsedMillis = Duration.ofNanos(System.nanoTime() - started).toMillis();
        assertTrue(elapsedMillis < 8_000, "failure exceeded bounded API timeout: " + elapsedMillis + " ms");
        assertThrows(software.amazon.awssdk.services.s3.model.S3Exception.class, () -> environment.directClient().headObject(
                software.amazon.awssdk.services.s3.model.HeadObjectRequest.builder().bucket(environment.bucket()).key(key).build()));

        environment.directClient().putObject(
                PutObjectRequest.builder().bucket(environment.bucket()).key(key).build(), RequestBody.fromBytes(payload));
        assertArrayEquals(payload, environment.directClient().getObjectAsBytes(
                GetObjectRequest.builder().bucket(environment.bucket()).key(key).build()).asByteArray());
        ProofEvidence.record(environment.runId(), "A10", "unreachable endpoint failed with SdkClientException in " + elapsedMillis + " ms; direct HEAD found no object; recovered path accepted PUT and verified bytes");
    }
    @Test
    void A11_upstreamInterruptionOccursAfterAnObservedBodyBarrier() throws Exception {
        String key = environment.newObjectKey("A11-interrupted");
        byte[] payload = environment.deterministicBytes("A11-interrupted", 4 * 1024 * 1024);
        try (S3FaultGate gate = new S3FaultGate(S3FaultGate.Mode.INTERRUPT_AFTER_BODY);
                var client = environment.clientAt(gate.endpoint())) {
            assertThrows(SdkClientException.class, () -> client.putObject(
                    PutObjectRequest.builder().bucket(environment.bucket()).key(key).build(), RequestBody.fromBytes(payload)));
            gate.awaitBodyBarrier();
        }
        byte[] visible = getIfPresent(key);
        assertTrue(visible == null || java.util.Arrays.equals(payload, visible), "an interrupted PUT exposed incomplete bytes");
        ProofEvidence.record(environment.runId(), "A11", "TCP gate forwarded at least 65,536 request-body bytes before reset; direct GET found " + (visible == null ? "no object" : "the complete original payload"));
    }

    @Test
    void A12_serverSuccessObservedBeforeTheResponseIsDropped() throws Exception {
        String key = environment.newObjectKey("A12-lost-response");
        byte[] payload = environment.deterministicBytes("A12-lost-response", 1024 * 1024);
        try (S3FaultGate gate = new S3FaultGate(S3FaultGate.Mode.DROP_AFTER_SUCCESS);
                var client = environment.clientAt(gate.endpoint())) {
            assertThrows(SdkClientException.class, () -> client.putObject(
                    PutObjectRequest.builder().bucket(environment.bucket()).key(key).build(), RequestBody.fromBytes(payload)));
            gate.awaitServerSuccess();
        }
        assertArrayEquals(payload, getIfPresent(key));
        ProofEvidence.record(environment.runId(), "A12", "fault gate observed SeaweedFS HTTP 200 after full PUT, dropped the downstream response, and direct GET verified the complete 1 MiB payload");
    }

    @Test
    void A13_containerRestartDuringHeldPutIsReconciledByDirectRead() throws Exception {
        String key = environment.newObjectKey("A13-restart-inflight");
        byte[] payload = environment.deterministicBytes("A13-restart-inflight", 2 * 1024 * 1024);
        try (S3FaultGate gate = new S3FaultGate(S3FaultGate.Mode.HOLD_AFTER_BODY);
                var client = environment.clientAt(gate.endpoint());
                var executor = java.util.concurrent.Executors.newSingleThreadExecutor()) {
            var put = executor.submit(() -> client.putObject(
                    PutObjectRequest.builder().bucket(environment.bucket()).key(key).build(), RequestBody.fromBytes(payload)));
            gate.awaitBodyBarrier();
            environment.recreateSeaweedfsContainer();
            gate.releaseBody();
            try { put.get(10, java.util.concurrent.TimeUnit.SECONDS); }
            catch (java.util.concurrent.ExecutionException | java.util.concurrent.TimeoutException ignored) {}
            byte[] visible = getIfPresent(key);
            assertTrue(visible == null || java.util.Arrays.equals(payload, visible), "restart left a partial visible object");
            ProofEvidence.record(environment.runId(), "A13", "container removed/recreated with the same volume while 65,536+ request bytes were held in the gate; direct GET found " + (visible == null ? "no object" : "complete bytes"));
        }
    }

    @Test
    void A14_deleteInterleavedWithBodyBarrierCannotProducePartialVisibleBytes() throws Exception {
        String key = environment.newObjectKey("A14-put-delete");
        byte[] payload = environment.deterministicBytes("A14-put-delete", 2 * 1024 * 1024);
        try (S3FaultGate gate = new S3FaultGate(S3FaultGate.Mode.HOLD_AFTER_BODY);
                var client = environment.clientAt(gate.endpoint());
                var executor = java.util.concurrent.Executors.newSingleThreadExecutor()) {
            var put = executor.submit(() -> client.putObject(
                    PutObjectRequest.builder().bucket(environment.bucket()).key(key).build(), RequestBody.fromBytes(payload)));
            gate.awaitBodyBarrier();
            var deleteResult = environment.directClient().deleteObject(
                    software.amazon.awssdk.services.s3.model.DeleteObjectRequest.builder().bucket(environment.bucket()).key(key).build());
            gate.releaseBody();
            String putOutcome = awaitPut(put);
            byte[] visible = getIfPresent(key);
            assertTrue(visible == null || java.util.Arrays.equals(payload, visible), "interleaved PUT/DELETE exposed partial bytes");
            ProofEvidence.record(environment.runId(), "A14", "DELETE HTTP " + deleteResult.sdkHttpResponse().statusCode() + " ran after the body barrier and before PUT release; PUT outcome=" + putOutcome + "; final direct GET=" + (visible == null ? "absent" : "complete original payload"));
        }
    }

    @Test
    void A15_conditionalPutInterleavedWithDeleteHasAtMostOneCompleteVisibleObject() throws Exception {
        var trialResults = new java.util.ArrayList<String>();
        for (int trial = 0; trial < 5; trial++) {
            String key = environment.newObjectKey("A15-conditional-put-delete-" + trial);
            byte[] payload = environment.deterministicBytes("A15-conditional-put-delete-" + trial, 2 * 1024 * 1024);
            try (S3FaultGate gate = new S3FaultGate(S3FaultGate.Mode.HOLD_AFTER_BODY);
                    var client = environment.clientAt(gate.endpoint());
                    var executor = java.util.concurrent.Executors.newSingleThreadExecutor()) {
                var put = executor.submit(() -> client.putObject(
                        PutObjectRequest.builder().bucket(environment.bucket()).key(key).ifNoneMatch("*").build(), RequestBody.fromBytes(payload)));
                gate.awaitBodyBarrier();
                var deleteResult = environment.directClient().deleteObject(
                        software.amazon.awssdk.services.s3.model.DeleteObjectRequest.builder().bucket(environment.bucket()).key(key).build());
                gate.releaseBody();
                String putOutcome = awaitPut(put);
                if (putOutcome.equals("TIMEOUT")) throw new AssertionError("conditional PUT did not settle after gate release");
                if (putOutcome.startsWith("S3 HTTP ") && !putOutcome.startsWith("S3 HTTP 409 ") && !putOutcome.startsWith("S3 HTTP 412 ")) {
                    throw new AssertionError("unexpected conditional provider response: " + putOutcome);
                }
                byte[] visible = getIfPresent(key);
                assertTrue(visible == null || java.util.Arrays.equals(payload, visible), "conditional interleaving exposed partial bytes");
                if (putOutcome.contains("Timeout")) {
                    Thread.sleep(2_000);
                    byte[] reconciled = getIfPresent(key);
                    assertTrue(reconciled == null || java.util.Arrays.equals(payload, reconciled), "late conditional PUT exposed partial bytes");
                    visible = reconciled;
                }
                trialResults.add("trial=" + trial + " DELETE=" + deleteResult.sdkHttpResponse().statusCode() + " PUT=" + putOutcome + " final=" + (visible == null ? "absent" : "complete"));
            }
        }
        ProofEvidence.record(environment.runId(), "A15", "five controlled conditional PUT/DELETE overlaps after 65,536+ body bytes: " + String.join("; ", trialResults));
    }

    private byte[] getIfPresent(String key) {
        try {
            return environment.directClient().getObjectAsBytes(
                    GetObjectRequest.builder().bucket(environment.bucket()).key(key).build()).asByteArray();
        } catch (software.amazon.awssdk.services.s3.model.S3Exception e) {
            if (e.statusCode() == 404) return null;
            throw e;
        }
    }

    private static String awaitPut(java.util.concurrent.Future<?> put) throws Exception {
        try {
            put.get(10, java.util.concurrent.TimeUnit.SECONDS);
            return "SUCCESS";
        } catch (java.util.concurrent.ExecutionException e) {
            Throwable cause = e.getCause();
            if (cause instanceof software.amazon.awssdk.services.s3.model.S3Exception s3) {
                return "S3 HTTP " + s3.statusCode() + " code=" + (s3.awsErrorDetails() == null ? "unknown" : s3.awsErrorDetails().errorCode());
            }
            return "FAILURE " + cause.getClass().getSimpleName() + ": " + cause.getMessage();
        } catch (java.util.concurrent.TimeoutException e) {
            return "TIMEOUT";
        }
    }

}
