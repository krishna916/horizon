package com.krishnamurti.horizon.poc.s3;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.UUID;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestInstance;
import software.amazon.awssdk.core.sync.RequestBody;
import software.amazon.awssdk.services.s3.model.HeadObjectRequest;
import software.amazon.awssdk.services.s3.model.PutObjectRequest;
import software.amazon.awssdk.services.s3.model.S3Exception;

@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class UploadValidationPolicyTest {

    private static final long MAX_BYTES = 20_971_519;
    private S3Environment environment;
    private Path tempDirectory;

    @BeforeAll
    void startEnvironment() throws Exception {
        java.util.TimeZone.setDefault(java.util.TimeZone.getTimeZone("UTC"));
        environment = S3Environment.start();
        tempDirectory = Files.createTempDirectory("issue75-validation-");
    }

    @AfterAll
    void closeEnvironment() throws Exception {
        if (environment != null) environment.close();
        if (tempDirectory != null) {
            try (var paths = Files.walk(tempDirectory)) {
                paths.sorted(java.util.Comparator.reverseOrder()).forEach(path -> {
                    try { Files.deleteIfExists(path); } catch (IOException e) { throw new IllegalStateException(e); }
                });
            }
        }
    }

    @Test
    void A04_acceptsTheMaximumAndRejectsOversizeUnknownAndMismatchedLengthsBeforePut() throws Exception {
        Path maximum = writeRepeated("maximum.bin", MAX_BYTES, (byte) 0x5a);
        assertEquals(MAX_BYTES, S3UploadPolicy.validate(maximum, MAX_BYTES, sha256(maximum)).observedBytes());

        assertRejectedBeforePut(writeRepeated("oversize.bin", MAX_BYTES + 1, (byte) 0x5a), MAX_BYTES + 1, "oversize");
        assertRejectedBeforePut(writeRepeated("unknown.bin", 12, (byte) 0x61), null, "unknown");
        assertRejectedBeforePut(writeRepeated("mismatch.bin", 13, (byte) 0x62), 12L, "mismatch");
        ProofEvidence.record(environment.runId(), "A04", "20,971,519 bytes accepted; 20,971,520, unknown length, and declared/observed mismatch rejected before PUT; rejected keys return HEAD 404");
    }

    @Test
    void A05_mutatedBoundedTempFileFailsSha256ValidationBeforePut() throws Exception {
        Path file = writeRepeated("checksum.bin", 8193, (byte) 0x31);
        String declaredSha256 = sha256(file);
        try (FileChannel channel = FileChannel.open(file, StandardOpenOption.WRITE)) {
            channel.write(ByteBuffer.wrap(new byte[] {(byte) 0xff}), 4096);
        }

        String key = environment.newObjectKey("A05-mutated-" + UUID.randomUUID());
        assertThrows(IllegalArgumentException.class, () -> uploadAfterValidation(key, file, Files.size(file), declaredSha256));
        assertAbsent(key);
        ProofEvidence.record(environment.runId(), "A05", "bounded temp file mutation changed SHA-256; validation rejected before PUT and independent HEAD returned 404");
    }

    private Path writeRepeated(String name, long length, byte value) throws IOException {
        Path path = tempDirectory.resolve(name);
        byte[] block = new byte[8192];
        java.util.Arrays.fill(block, value);
        try (var output = Files.newOutputStream(path, StandardOpenOption.CREATE, StandardOpenOption.TRUNCATE_EXISTING)) {
            long remaining = length;
            while (remaining > 0) {
                int count = (int) Math.min(remaining, block.length);
                output.write(block, 0, count);
                remaining -= count;
            }
        }
        return path;
    }

    private void assertRejectedBeforePut(Path path, Long declaredLength, String caseName) throws Exception {
        String key = environment.newObjectKey("A04-" + caseName + "-" + UUID.randomUUID());
        assertThrows(IllegalArgumentException.class, () -> uploadAfterValidation(key, path, declaredLength, sha256(path)));
        assertAbsent(key);
    }

    private void uploadAfterValidation(String key, Path file, Long declaredLength, String expectedSha256) throws Exception {
        S3UploadPolicy.validate(file, declaredLength, expectedSha256);
        environment.directClient().putObject(
                PutObjectRequest.builder().bucket(environment.bucket()).key(key).contentLength(Files.size(file)).build(),
                RequestBody.fromFile(file));
    }

    private void assertAbsent(String key) {
        S3Exception missing = assertThrows(
                S3Exception.class,
                () -> environment.directClient().headObject(
                        HeadObjectRequest.builder().bucket(environment.bucket()).key(key).build()));
        assertEquals(404, missing.statusCode());
    }

    private static String sha256(Path file) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        try (var input = Files.newInputStream(file)) {
            byte[] block = new byte[8192];
            int count;
            while ((count = input.read(block)) != -1) digest.update(block, 0, count);
        }
        return HexFormat.of().formatHex(digest.digest());
    }
}
