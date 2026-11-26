package com.krishnamurti.horizon.file.domain;

import com.krishnamurti.horizon.file.api.model.FileDescriptor;
import com.krishnamurti.horizon.file.api.model.FileScope;
import java.io.ByteArrayOutputStream;
import java.io.DataOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;

public final class FileRequestFingerprint {
    private FileRequestFingerprint() {}

    public static String compute(FileScope scope, FileDescriptor descriptor) {
        try {
            ByteArrayOutputStream bytes = new ByteArrayOutputStream();
            DataOutputStream output = new DataOutputStream(bytes);
            write(output, "1");
            write(output, scope.userId().toString());
            write(output, scope.workspace());
            write(output, scope.bindingFingerprint());
            write(output, descriptor.originalFilename());
            write(output, descriptor.declaredContentType());
            write(output, Long.toString(descriptor.expectedSize()));
            write(output, descriptor.expectedSha256());
            return HexFormat.of()
                    .formatHex(MessageDigest.getInstance("SHA-256").digest(bytes.toByteArray()));
        } catch (IOException | NoSuchAlgorithmException exception) {
            throw new IllegalStateException("Unable to fingerprint file request", exception);
        }
    }

    private static void write(DataOutputStream output, String value) throws IOException {
        byte[] utf8 = value.getBytes(StandardCharsets.UTF_8);
        output.writeInt(utf8.length);
        output.write(utf8);
    }
}
