package com.krishnamurti.horizon.file.infrastructure.validation;

import com.krishnamurti.horizon.file.api.FileOperationException;
import com.krishnamurti.horizon.file.api.model.FileDescriptor;
import com.krishnamurti.horizon.file.api.model.FileFormat;
import com.krishnamurti.horizon.file.infrastructure.staging.StagedFile;
import edu.umd.cs.findbugs.annotations.SuppressFBWarnings;
import java.io.IOException;
import java.util.EnumMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import org.springframework.stereotype.Component;

@Component
@SuppressFBWarnings(
        value = "CT_CONSTRUCTOR_THROW",
        justification =
                "Duplicate validator registration is invalid startup configuration and is rejected"
                        + " before service use.")
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
            throw failure(
                    FileOperationException.Reason.INVALID_CONTENT, "Staged bytes are invalid");
        }
        String filename = descriptor.originalFilename();
        int separator = filename.lastIndexOf('.');
        if (separator < 0 || separator == filename.length() - 1) {
            throw failure(
                    FileOperationException.Reason.UNSUPPORTED_FORMAT, "File format is unsupported");
        }
        FileFormat expected =
                EXTENSIONS.get(filename.substring(separator + 1).toLowerCase(Locale.ROOT));
        if (expected == null) {
            throw failure(
                    FileOperationException.Reason.UNSUPPORTED_FORMAT, "File format is unsupported");
        }
        String canonicalMediaType = MEDIA_TYPES.get(expected);
        if (!canonicalMediaType.equals(
                normalizeDeclaredContentType(descriptor.declaredContentType(), expected))) {
            throw failure(
                    FileOperationException.Reason.INVALID_METADATA,
                    "Declared content type does not match the supported format");
        }
        FileValidator validator = validators.get(expected);
        if (validator == null) {
            throw failure(
                    FileOperationException.Reason.UNSUPPORTED_FORMAT, "File format is unsupported");
        }
        ValidationResult detected;
        try {
            detected = validator.validate(stagedFile, expected);
        } catch (FileOperationException exception) {
            throw exception;
        } catch (IllegalArgumentException exception) {
            throw failure(
                    FileOperationException.Reason.INVALID_CONTENT,
                    "File content is invalid",
                    exception);
        }
        if (detected.format() != expected || !canonicalMediaType.equals(detected.mediaType())) {
            throw failure(
                    FileOperationException.Reason.INVALID_CONTENT,
                    "Detected content does not match its filename and content type");
        }
        return detected;
    }

    private static String normalizeDeclaredContentType(String declared, FileFormat format) {
        if (declared == null) {
            return "";
        }
        String[] pieces = declared.split(";", -1);
        String mediaType = pieces[0].trim().toLowerCase(Locale.ROOT);
        if (pieces.length == 1) {
            return mediaType;
        }
        if (!isTextFormat(format) || pieces.length != 2) {
            return "";
        }
        String[] parameter = pieces[1].trim().split("=", 2);
        if (parameter.length != 2 || !parameter[0].trim().equalsIgnoreCase("charset")) {
            return "";
        }
        String charset = parameter[1].trim();
        if (charset.length() >= 2 && charset.startsWith("\"") && charset.endsWith("\"")) {
            charset = charset.substring(1, charset.length() - 1);
        }
        if (charset.indexOf('"') >= 0 || !charset.equalsIgnoreCase("utf-8")) return "";
        return mediaType;
    }

    private static boolean isTextFormat(FileFormat format) {
        return format == FileFormat.TXT
                || format == FileFormat.MD
                || format == FileFormat.CSV
                || format == FileFormat.MERMAID;
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

    private static FileOperationException failure(
            FileOperationException.Reason reason, String message) {
        return new FileOperationException(reason, message);
    }

    private static FileOperationException failure(
            FileOperationException.Reason reason, String message, Throwable cause) {
        return new FileOperationException(reason, message, cause);
    }
}
