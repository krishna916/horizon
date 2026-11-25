package com.krishnamurti.horizon.file.infrastructure.validation;

import com.krishnamurti.horizon.file.api.model.FileFormat;
import com.krishnamurti.horizon.file.infrastructure.staging.StagedFile;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.PushbackReader;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.util.Set;
import org.springframework.stereotype.Component;

@Component
public class TextFileValidator implements FileValidator {
    private static final Set<FileFormat> TEXT_FORMATS =
            Set.of(FileFormat.TXT, FileFormat.MD, FileFormat.CSV, FileFormat.MERMAID);

    @Override
    public boolean supports(FileFormat format) {
        return TEXT_FORMATS.contains(format);
    }

    @Override
    public ValidationResult validate(StagedFile stagedFile) throws IOException {
        return validate(stagedFile, FileFormat.TXT);
    }

    ValidationResult validate(StagedFile stagedFile, FileFormat format) throws IOException {
        if (!supports(format)) {
            throw invalid("Unsupported text format");
        }
        var decoder =
                StandardCharsets.UTF_8
                        .newDecoder()
                        .onMalformedInput(CodingErrorAction.REPORT)
                        .onUnmappableCharacter(CodingErrorAction.REPORT);
        StringBuilder prefix = new StringBuilder(512);
        LeadingMarkupInspector markupInspector = new LeadingMarkupInspector(format);
        try (PushbackReader reader =
                new PushbackReader(
                        new InputStreamReader(
                                java.nio.file.Files.newInputStream(stagedFile.path()), decoder),
                        1)) {
            int first = reader.read();
            if (first == 0xfeff) {
                first = reader.read();
            }
            if (first >= 0) {
                reader.unread(first);
            }
            char[] buffer = new char[8_192];
            int read;
            while ((read = reader.read(buffer)) >= 0) {
                if (read == 0) {
                    continue;
                }
                for (int index = 0; index < read; index++) {
                    char value = buffer[index];
                    if (value == '\0' || isDisallowedControl(value)) {
                        throw invalid("Binary or control content is not accepted as text");
                    }
                    if (markupInspector.accept(value)) {
                        throw invalid("Standalone HTML and SVG documents are not accepted");
                    }
                    if (prefix.length() < 512
                            && (prefix.length() > 0 || !Character.isWhitespace(value))) {
                        prefix.append(value);
                    }
                }
            }
        } catch (java.nio.charset.CharacterCodingException exception) {
            throw new IllegalArgumentException("Text content must be valid UTF-8", exception);
        }
        if (markupInspector.finish()) {
            throw invalid("Standalone HTML and SVG documents are not accepted");
        }
        rejectExecutableSignature(prefix.toString());
        return new ValidationResult(format, mediaType(format));
    }

    private static void rejectExecutableSignature(String prefix) {
        String start = prefix.stripLeading().toLowerCase(java.util.Locale.ROOT);
        if (start.startsWith("mz") || start.startsWith("#!") || start.startsWith("\u007felf")) {
            throw invalid("Executable content is not accepted as text");
        }
    }

    private static final class LeadingMarkupInspector {
        private enum State {
            LEADING,
            AFTER_LT,
            DECLARATION,
            COMMENT,
            PROCESSING_INSTRUCTION,
            TAG_NAME,
            DONE
        }

        private final FileFormat format;
        private State state = State.LEADING;
        private final StringBuilder token = new StringBuilder(16);
        private int commentDashes;
        private boolean processingQuestion;

        private LeadingMarkupInspector(FileFormat format) {
            this.format = format;
        }

        private boolean accept(char value) {
            if (state == State.DONE) {
                return false;
            }
            switch (state) {
                case LEADING -> {
                    if (Character.isWhitespace(value)) {
                        return false;
                    }
                    if (value == '<') {
                        state = State.AFTER_LT;
                        return false;
                    }
                    state = State.DONE;
                }
                case AFTER_LT -> {
                    if (value == '!') {
                        state = State.DECLARATION;
                        token.setLength(0);
                    } else if (value == '?') {
                        state = State.PROCESSING_INSTRUCTION;
                    } else if (Character.isLetter(value)) {
                        token.setLength(0);
                        token.append(Character.toLowerCase(value));
                        state = State.TAG_NAME;
                    } else {
                        state = State.DONE;
                    }
                }
                case DECLARATION -> {
                    if (value == '-' && token.isEmpty()) {
                        token.append('-');
                    } else if (value == '-' && token.toString().equals("-")) {
                        state = State.COMMENT;
                        commentDashes = 0;
                    } else if (Character.isLetter(value)) {
                        token.append(Character.toLowerCase(value));
                        if (token.toString().equals("doctype")) {
                            return true;
                        }
                    } else if (Character.isWhitespace(value) || value == '>') {
                        state = State.DONE;
                    } else {
                        state = State.DONE;
                    }
                }
                case COMMENT -> {
                    if (value == '-') {
                        commentDashes = Math.min(2, commentDashes + 1);
                    } else if (value == '>' && commentDashes >= 2) {
                        state = State.LEADING;
                        commentDashes = 0;
                    } else {
                        commentDashes = 0;
                    }
                }
                case PROCESSING_INSTRUCTION -> {
                    if (value == '>' && processingQuestion) {
                        state = State.LEADING;
                        processingQuestion = false;
                    } else {
                        processingQuestion = value == '?';
                    }
                }
                case TAG_NAME -> {
                    if (Character.isLetterOrDigit(value) || value == '-' || value == ':') {
                        if (token.length() < 32) {
                            token.append(Character.toLowerCase(value));
                        }
                    } else {
                        String root = token.toString();
                        if (root.equals("html")
                                || root.equals("head")
                                || root.equals("body")
                                || root.equals("svg")
                                || (root.equals("script") && format != FileFormat.MD)) {
                            return true;
                        }
                        state = State.DONE;
                    }
                }
                case DONE -> {
                    return false;
                }
            }
            return false;
        }

        private boolean finish() {
            return state == State.TAG_NAME
                    && (token.toString().equals("html")
                            || token.toString().equals("head")
                            || token.toString().equals("body")
                            || token.toString().equals("svg")
                            || (token.toString().equals("script") && format != FileFormat.MD));
        }
    }

    private static boolean isDisallowedControl(char value) {
        return Character.isISOControl(value)
                && value != '\n'
                && value != '\r'
                && value != '\t'
                && value != '\f';
    }

    private static String mediaType(FileFormat format) {
        return switch (format) {
            case TXT -> "text/plain";
            case MD -> "text/markdown";
            case CSV -> "text/csv";
            case MERMAID -> "text/vnd.mermaid";
            default -> throw new IllegalArgumentException("Not a text format");
        };
    }

    private static IllegalArgumentException invalid(String message) {
        return new IllegalArgumentException(message);
    }
}
