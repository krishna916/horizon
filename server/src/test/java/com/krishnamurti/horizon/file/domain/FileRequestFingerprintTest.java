package com.krishnamurti.horizon.file.domain;

import static org.assertj.core.api.Assertions.assertThat;

import com.krishnamurti.horizon.file.api.model.FileDescriptor;
import com.krishnamurti.horizon.file.api.model.FileScope;
import org.junit.jupiter.api.Test;

class FileRequestFingerprintTest {
    private static final FileScope SCOPE =
            new FileScope(
                    7L,
                    "notes",
                    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef");
    private static final FileDescriptor DESCRIPTOR =
            new FileDescriptor(
                    "a.txt",
                    "text/plain",
                    1,
                    "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");

    @Test
    void canonicalVectorIsStable() {
        assertThat(FileRequestFingerprint.compute(SCOPE, DESCRIPTOR))
                .isEqualTo("ec0ae20cee17dd3db05a2ab1a7c1546b63d8617dee9f7248d80d9cbc9ce3893d");
    }

    @Test
    void changedIdentityChangesFingerprint() {
        String original = FileRequestFingerprint.compute(SCOPE, DESCRIPTOR);

        assertThat(
                        FileRequestFingerprint.compute(
                                new FileScope(8L, "notes", SCOPE.bindingFingerprint()), DESCRIPTOR))
                .isNotEqualTo(original);
        assertThat(
                        FileRequestFingerprint.compute(
                                new FileScope(7L, "tasks", SCOPE.bindingFingerprint()), DESCRIPTOR))
                .isNotEqualTo(original);
        assertThat(
                        FileRequestFingerprint.compute(
                                new FileScope(7L, "notes", "b".repeat(64)), DESCRIPTOR))
                .isNotEqualTo(original);
        assertThat(
                        FileRequestFingerprint.compute(
                                SCOPE,
                                new FileDescriptor(
                                        "b.txt", "text/plain", 1, DESCRIPTOR.expectedSha256())))
                .isNotEqualTo(original);
        assertThat(
                        FileRequestFingerprint.compute(
                                SCOPE,
                                new FileDescriptor(
                                        "a.txt",
                                        "application/pdf",
                                        1,
                                        DESCRIPTOR.expectedSha256())))
                .isNotEqualTo(original);
        assertThat(
                        FileRequestFingerprint.compute(
                                SCOPE,
                                new FileDescriptor(
                                        "a.txt", "text/plain", 2, DESCRIPTOR.expectedSha256())))
                .isNotEqualTo(original);
        assertThat(
                        FileRequestFingerprint.compute(
                                SCOPE,
                                new FileDescriptor("a.txt", "text/plain", 1, "b".repeat(64))))
                .isNotEqualTo(original);
    }

    @Test
    void lengthPrefixPreventsAmbiguousConcatenationAndUsesUtf8ByteLengths() {
        FileDescriptor descriptor = new FileDescriptor("é.txt", "text/plain", 1, "a".repeat(64));
        String first = FileRequestFingerprint.compute(new FileScope(7L, "a", "bc"), descriptor);
        String second = FileRequestFingerprint.compute(new FileScope(7L, "ab", "c"), descriptor);
        String multibyte = FileRequestFingerprint.compute(new FileScope(7L, "é", "c"), descriptor);
        String singleByte = FileRequestFingerprint.compute(new FileScope(7L, "e", "c"), descriptor);
        assertThat(first).isNotEqualTo(second);
        assertThat(multibyte).isNotEqualTo(singleByte);
    }
}
