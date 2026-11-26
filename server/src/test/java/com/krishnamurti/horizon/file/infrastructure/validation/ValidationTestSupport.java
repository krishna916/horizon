package com.krishnamurti.horizon.file.infrastructure.validation;

import com.krishnamurti.horizon.file.api.model.FileDescriptor;
import com.krishnamurti.horizon.file.infrastructure.FileProperties;
import com.krishnamurti.horizon.file.infrastructure.staging.FileStagingService;
import com.krishnamurti.horizon.file.infrastructure.staging.StagedFile;
import com.krishnamurti.horizon.file.infrastructure.staging.StagingCapacity;
import com.krishnamurti.horizon.file.infrastructure.staging.StagingDirectory;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;
import javax.imageio.ImageIO;

final class ValidationTestSupport {
    private ValidationTestSupport() {}

    static StagedFixture stage(Path directory, byte[] bytes) throws IOException {
        FileProperties properties = new FileProperties();
        properties.setMaxFileSize(org.springframework.util.unit.DataSize.ofBytes(104_857_600));
        properties.getStaging().setDirectory(directory.toString());
        StagingDirectory stagingDirectory = new StagingDirectory(directory);
        FileStagingService staging =
                new FileStagingService(
                        properties, new StagingCapacity(properties), stagingDirectory);
        FileDescriptor expected =
                new FileDescriptor(
                        "input.bin", "application/octet-stream", bytes.length, sha256(bytes));
        StagedFile file = staging.stage(new ByteArrayInputStream(bytes), bytes.length, expected);
        return new StagedFixture(file, stagingDirectory);
    }

    static String sha256(byte[] bytes) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException(exception);
        }
    }

    static byte[] fixture(String name) throws IOException {
        try (var input =
                ValidationTestSupport.class.getResourceAsStream("/file/fixtures/" + name)) {
            if (input == null) {
                throw new IOException("Missing test fixture: " + name);
            }
            return input.readAllBytes();
        }
    }

    static byte[] image(String format, int width, int height) throws IOException {
        BufferedImage image = new BufferedImage(width, height, BufferedImage.TYPE_INT_RGB);
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        if (!ImageIO.write(image, format, output)) {
            throw new IOException("No test writer for " + format);
        }
        return output.toByteArray();
    }

    static byte[] zip(java.util.Map<String, byte[]> entries) throws IOException {
        java.util.List<ZipPart> parts =
                entries.entrySet().stream()
                        .map(entry -> new ZipPart(entry.getKey(), entry.getValue()))
                        .toList();
        return zipParts(parts);
    }

    static byte[] zipParts(java.util.List<ZipPart> entries) throws IOException {
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        try (ZipOutputStream zip = new ZipOutputStream(bytes, StandardCharsets.UTF_8)) {
            for (ZipPart entry : entries) {
                zip.putNextEntry(new ZipEntry(entry.name()));
                zip.write(entry.bytes());
                zip.closeEntry();
            }
        }
        return bytes.toByteArray();
    }

    record ZipPart(String name, byte[] bytes) {}

    record StagedFixture(StagedFile file, StagingDirectory directory) implements AutoCloseable {
        @Override
        public void close() throws IOException {
            try {
                file.close();
            } finally {
                directory.close();
            }
        }
    }
}
