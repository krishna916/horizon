package com.krishnamurti.horizon.poc.s3;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;

/** Test-only bounded-file validation policy; it performs no S3 operation. */
final class S3UploadPolicy {

    static final long MAX_BYTES = 20_971_519;
    private static final int BUFFER_SIZE = 8192;

    private S3UploadPolicy() {}

    static ValidationResult validate(Path file, Long declaredBytes, String declaredSha256) {
        if (declaredBytes == null || declaredBytes < 0) {
            throw new IllegalArgumentException("A non-negative known content length is required");
        }
        if (declaredBytes > MAX_BYTES) {
            throw new IllegalArgumentException("The declared content length exceeds the configured maximum");
        }
        if (declaredSha256 == null || !declaredSha256.matches("(?i)[0-9a-f]{64}")) {
            throw new IllegalArgumentException("A SHA-256 digest is required");
        }

        MessageDigest digest;
        try {
            digest = MessageDigest.getInstance("SHA-256");
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 is required by the Java runtime", e);
        }

        long observedBytes = 0;
        try (var input = Files.newInputStream(file)) {
            byte[] buffer = new byte[BUFFER_SIZE];
            int count;
            while ((count = input.read(buffer)) != -1) {
                observedBytes += count;
                if (observedBytes > MAX_BYTES) {
                    throw new IllegalArgumentException("The observed content length exceeds the configured maximum");
                }
                digest.update(buffer, 0, count);
            }
        } catch (IOException e) {
            throw new IllegalArgumentException("The bounded temporary file could not be read", e);
        }

        if (observedBytes != declaredBytes) {
            throw new IllegalArgumentException("Declared and observed content lengths differ");
        }
        String observedSha256 = HexFormat.of().formatHex(digest.digest());
        if (!observedSha256.equalsIgnoreCase(declaredSha256)) {
            throw new IllegalArgumentException("The declared SHA-256 does not match the temporary file");
        }
        return new ValidationResult(observedBytes, observedSha256);
    }

    record ValidationResult(long observedBytes, String sha256) {}
}
