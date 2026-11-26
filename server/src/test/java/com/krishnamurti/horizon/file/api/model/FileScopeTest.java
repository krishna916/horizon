package com.krishnamurti.horizon.file.api.model;

import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.Set;
import org.junit.jupiter.api.Test;

class FileScopeTest {

    private static final String FINGERPRINT = "a".repeat(64);

    @Test
    void rejectsMissingAndNonPositiveOwners() {
        assertThatThrownBy(() -> new FileScope(null, "notes", FINGERPRINT))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> new FileScope(0L, "notes", FINGERPRINT))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void rejectsUnsafeWorkspaceIdentifiers() {
        assertThatThrownBy(() -> new FileScope(1L, "", FINGERPRINT))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> new FileScope(1L, "x".repeat(65), FINGERPRINT))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> new FileScope(1L, "notes/files", FINGERPRINT))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> new FileScope(1L, "notes\\files", FINGERPRINT))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> new FileScope(1L, "notes..files", FINGERPRINT))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void rejectsBlankBindingFingerprint() {
        assertThatThrownBy(() -> new FileScope(1L, "notes", " "))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void uploadPolicyRejectsNonPositiveMaximum() {
        assertThatThrownBy(() -> new FileUploadPolicy(0L, Set.of(FileFormat.PDF)))
                .isInstanceOf(IllegalArgumentException.class);
    }
}
