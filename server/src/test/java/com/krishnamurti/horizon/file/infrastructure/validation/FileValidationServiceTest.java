package com.krishnamurti.horizon.file.infrastructure.validation;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.krishnamurti.horizon.file.api.model.FileDescriptor;
import com.krishnamurti.horizon.file.api.model.FileFormat;
import java.nio.file.Path;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class FileValidationServiceTest {
    @TempDir Path temporaryDirectory;

    @Test
    void dispatchesToOneValidatorAndChecksFilenameAndMime() throws Exception {
        byte[] png = ValidationTestSupport.image("png", 1, 1);
        String sha = ValidationTestSupport.sha256(png);
        FileDescriptor descriptor = new FileDescriptor("picture.png", "image/png", png.length, sha);
        try (ValidationTestSupport.StagedFixture fixture =
                ValidationTestSupport.stage(temporaryDirectory.resolve("stage"), png)) {
            var validators =
                    List.<FileValidator>of(
                            new ImageFileValidator(),
                            new PdfFileValidator(),
                            new OfficeFileValidator(),
                            new TextFileValidator());
            assertThat(
                            new FileValidationService(validators)
                                    .validate(fixture.file(), descriptor)
                                    .format())
                    .isEqualTo(FileFormat.PNG);
        }
    }

    @Test
    void jpgExtensionAliasIsValidatedAsJpeg() throws Exception {
        byte[] jpeg = ValidationTestSupport.image("jpeg", 1, 1);
        FileDescriptor descriptor =
                new FileDescriptor(
                        "picture.jpg",
                        "image/jpeg",
                        jpeg.length,
                        ValidationTestSupport.sha256(jpeg));
        FileValidationService service =
                new FileValidationService(
                        List.of(
                                new ImageFileValidator(),
                                new PdfFileValidator(),
                                new OfficeFileValidator(),
                                new TextFileValidator()));
        try (ValidationTestSupport.StagedFixture fixture =
                ValidationTestSupport.stage(temporaryDirectory.resolve("jpg-alias"), jpeg)) {
            assertThat(service.validate(fixture.file(), descriptor).format())
                    .isEqualTo(FileFormat.JPEG);
        }
    }

    @Test
    void extensionAndMimeSpoofAndUnsupportedFallbackAreRejected() throws Exception {
        byte[] png = ValidationTestSupport.image("png", 1, 1);
        FileDescriptor mismatch =
                new FileDescriptor(
                        "picture.jpg", "image/png", png.length, ValidationTestSupport.sha256(png));
        FileDescriptor mimeMismatch =
                new FileDescriptor(
                        "picture.png", "image/jpeg", png.length, ValidationTestSupport.sha256(png));
        try (ValidationTestSupport.StagedFixture fixture =
                ValidationTestSupport.stage(temporaryDirectory.resolve("stage"), png)) {
            FileValidationService service =
                    new FileValidationService(
                            List.of(
                                    new ImageFileValidator(),
                                    new PdfFileValidator(),
                                    new OfficeFileValidator(),
                                    new TextFileValidator()));
            assertThatThrownBy(() -> service.validate(fixture.file(), mismatch))
                    .isInstanceOf(IllegalArgumentException.class);
            assertThatThrownBy(() -> service.validate(fixture.file(), mimeMismatch))
                    .isInstanceOf(IllegalArgumentException.class);
            FileValidationService noStrategies = new FileValidationService(List.of());
            FileDescriptor correct =
                    new FileDescriptor(
                            "picture.png",
                            "image/png",
                            png.length,
                            ValidationTestSupport.sha256(png));
            assertThatThrownBy(() -> noStrategies.validate(fixture.file(), correct))
                    .isInstanceOf(IllegalArgumentException.class);
            assertThatThrownBy(
                            () ->
                                    new FileValidationService(
                                            List.of(
                                                    new ImageFileValidator(),
                                                    new ImageFileValidator())))
                    .isInstanceOf(IllegalStateException.class);
        }
    }

    @Test
    void allTextExtensionsUseTheirCanonicalMediaTypes() throws Exception {
        String[][] declared = {
            {"txt", "text/plain"},
            {"md", "text/markdown"},
            {"csv", "text/csv"},
            {"mmd", "text/vnd.mermaid"},
            {"mermaid", "text/vnd.mermaid"}
        };
        byte[] bytes = "graph TD; A-->B".getBytes(java.nio.charset.StandardCharsets.UTF_8);
        FileValidationService service =
                new FileValidationService(
                        List.of(
                                new ImageFileValidator(),
                                new PdfFileValidator(),
                                new OfficeFileValidator(),
                                new TextFileValidator()));
        for (String[] item : declared) {
            FileDescriptor descriptor =
                    new FileDescriptor(
                            "diagram." + item[0],
                            item[1],
                            bytes.length,
                            ValidationTestSupport.sha256(bytes));
            try (ValidationTestSupport.StagedFixture fixture =
                    ValidationTestSupport.stage(temporaryDirectory.resolve(item[0]), bytes)) {
                assertThat(service.validate(fixture.file(), descriptor).mediaType())
                        .isEqualTo(item[1]);
            }
        }

        FileDescriptor alias =
                new FileDescriptor(
                        "diagram.md",
                        "text/plain",
                        bytes.length,
                        ValidationTestSupport.sha256(bytes));
        try (ValidationTestSupport.StagedFixture fixture =
                ValidationTestSupport.stage(temporaryDirectory.resolve("mime-alias"), bytes)) {
            assertThatThrownBy(() -> service.validate(fixture.file(), alias))
                    .isInstanceOf(IllegalArgumentException.class);
        }
    }
}
