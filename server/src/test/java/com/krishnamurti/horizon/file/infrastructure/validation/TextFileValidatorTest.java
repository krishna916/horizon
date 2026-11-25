package com.krishnamurti.horizon.file.infrastructure.validation;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.krishnamurti.horizon.file.api.model.FileFormat;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class TextFileValidatorTest {
    @TempDir Path temporaryDirectory;

    @Test
    void strictUtf8AndBomAreAccepted() throws Exception {
        byte[] bytes = {(byte) 0xef, (byte) 0xbb, (byte) 0xbf, 'h', 'i'};
        try (ValidationTestSupport.StagedFixture fixture =
                ValidationTestSupport.stage(temporaryDirectory.resolve("text"), bytes)) {
            assertThat(new TextFileValidator().validate(fixture.file(), FileFormat.MD).format())
                    .isEqualTo(FileFormat.MD);
        }
    }

    @Test
    void invalidUtf8AndStandaloneActiveMarkupAreRejected() throws Exception {
        for (byte[] bytes :
                new byte[][] {
                    {(byte) 0xc3, 0x28},
                    "<svg xmlns=\"http://www.w3.org/2000/svg\"><script/>"
                            .getBytes(StandardCharsets.UTF_8),
                    "<!doctype html><script>alert(1)</script>".getBytes(StandardCharsets.UTF_8)
                }) {
            try (ValidationTestSupport.StagedFixture fixture =
                    ValidationTestSupport.stage(
                            temporaryDirectory.resolve(java.util.UUID.randomUUID().toString()),
                            bytes)) {
                assertThatThrownBy(
                                () ->
                                        new TextFileValidator()
                                                .validate(fixture.file(), FileFormat.TXT))
                        .isInstanceOf(IllegalArgumentException.class);
            }
        }
    }

    @Test
    void markdownHtmlSnippetRemainsInertText() throws Exception {
        byte[] bytes = "# inert\n<script>alert(1)</script>".getBytes(StandardCharsets.UTF_8);
        try (ValidationTestSupport.StagedFixture fixture =
                ValidationTestSupport.stage(temporaryDirectory.resolve("markdown"), bytes)) {
            assertThat(new TextFileValidator().validate(fixture.file(), FileFormat.MD).format())
                    .isEqualTo(FileFormat.MD);
        }
        byte[] standaloneHtml =
                (" ".repeat(1_024) + "<!doctype html><html><script>run()</script></html>")
                        .getBytes(StandardCharsets.UTF_8);
        try (ValidationTestSupport.StagedFixture fixture =
                ValidationTestSupport.stage(
                        temporaryDirectory.resolve("standalone-html"), standaloneHtml)) {
            assertThatThrownBy(
                            () -> new TextFileValidator().validate(fixture.file(), FileFormat.MD))
                    .isInstanceOf(IllegalArgumentException.class);
        }
        byte[] standaloneSvg =
                ("<?xml version=\"1.0\"?>\n<!-- "
                                + "x".repeat(1_024)
                                + " -->\n<svg xmlns=\"http://www.w3.org/2000/svg\"/>")
                        .getBytes(StandardCharsets.UTF_8);
        try (ValidationTestSupport.StagedFixture fixture =
                ValidationTestSupport.stage(
                        temporaryDirectory.resolve("standalone-svg"), standaloneSvg)) {
            assertThatThrownBy(
                            () -> new TextFileValidator().validate(fixture.file(), FileFormat.TXT))
                    .isInstanceOf(IllegalArgumentException.class);
        }
    }
}
