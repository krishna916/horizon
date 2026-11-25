package com.krishnamurti.horizon.file.infrastructure.validation;

import com.krishnamurti.horizon.file.api.model.FileDescriptor;
import com.krishnamurti.horizon.file.api.model.FileFormat;
import com.krishnamurti.horizon.file.infrastructure.staging.StagedFile;
import java.io.IOException;
import java.util.EnumMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import org.springframework.stereotype.Component;

@Component
public class FileValidationService {
    private static final Map<String, FileFormat> EXTENSIONS = extensions();
    private static final Map<FileFormat, String> MEDIA_TYPES = mediaTypes();
    private final Map<FileFormat, FileValidator> validators;

    public FileValidationService(List<FileValidator> strategies) {
        EnumMap<FileFormat, FileValidator> indexed = new EnumMap<>(FileFormat.class);
        for (FileValidator strategy : strategies) {
            for (FileFormat format : FileFormat.values()) {
                if (strategy.supports(format) && indexed.putIfAbsent(format, strategy) != null) {
                    throw new IllegalStateException("Multiple validators support " + format);
                }
            }
        }
        validators = Map.copyOf(indexed);
    }

    public ValidationResult validate(StagedFile stagedFile, FileDescriptor descriptor)
            throws IOException {
        if (stagedFile.sizeBytes() != descriptor.expectedSize()
                || !stagedFile.sha256().equals(descriptor.expectedSha256())) {
            throw invalid("Staged file does not match its prepared descriptor");
        }
        String filename = descriptor.originalFilename();
        int separator = filename.lastIndexOf('.');
        if (separator < 0 || separator == filename.length() - 1) {
            throw invalid("Filename extension is not supported");
        }
        FileFormat expected =
                EXTENSIONS.get(filename.substring(separator + 1).toLowerCase(Locale.ROOT));
        if (expected == null) {
            throw invalid("Filename extension is not supported");
        }
        String canonicalMediaType = MEDIA_TYPES.get(expected);
        if (!canonicalMediaType.equals(descriptor.declaredContentType().toLowerCase(Locale.ROOT))) {
            throw invalid("Declared content type does not match the supported format");
        }
        FileValidator validator = validators.get(expected);
        if (validator == null) {
            throw invalid("No validator supports the declared format");
        }
        ValidationResult detected =
                validator instanceof TextFileValidator textValidator
                        ? textValidator.validate(stagedFile, expected)
                        : validator.validate(stagedFile);
        if (detected.format() != expected || !canonicalMediaType.equals(detected.mediaType())) {
            throw invalid("Detected content does not match its filename and content type");
        }
        return detected;
    }

    private static Map<String, FileFormat> extensions() {
        Map<String, FileFormat> map = new java.util.HashMap<>();
        map.put("jpg", FileFormat.JPEG);
        map.put("jpeg", FileFormat.JPEG);
        map.put("png", FileFormat.PNG);
        map.put("webp", FileFormat.WEBP);
        map.put("gif", FileFormat.GIF);
        map.put("pdf", FileFormat.PDF);
        map.put("docx", FileFormat.DOCX);
        map.put("xlsx", FileFormat.XLSX);
        map.put("pptx", FileFormat.PPTX);
        map.put("txt", FileFormat.TXT);
        map.put("md", FileFormat.MD);
        map.put("csv", FileFormat.CSV);
        map.put("mmd", FileFormat.MERMAID);
        map.put("mermaid", FileFormat.MERMAID);
        return Map.copyOf(map);
    }

    private static Map<FileFormat, String> mediaTypes() {
        EnumMap<FileFormat, String> map = new EnumMap<>(FileFormat.class);
        map.put(FileFormat.JPEG, "image/jpeg");
        map.put(FileFormat.PNG, "image/png");
        map.put(FileFormat.WEBP, "image/webp");
        map.put(FileFormat.GIF, "image/gif");
        map.put(FileFormat.PDF, "application/pdf");
        map.put(
                FileFormat.DOCX,
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
        map.put(
                FileFormat.XLSX,
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        map.put(
                FileFormat.PPTX,
                "application/vnd.openxmlformats-officedocument.presentationml.presentation");
        map.put(FileFormat.TXT, "text/plain");
        map.put(FileFormat.MD, "text/markdown");
        map.put(FileFormat.CSV, "text/csv");
        map.put(FileFormat.MERMAID, "text/vnd.mermaid");
        return Map.copyOf(map);
    }

    private static IllegalArgumentException invalid(String message) {
        return new IllegalArgumentException(message);
    }
}
