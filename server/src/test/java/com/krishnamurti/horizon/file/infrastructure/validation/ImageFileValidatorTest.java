package com.krishnamurti.horizon.file.infrastructure.validation;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.krishnamurti.horizon.file.api.model.FileFormat;
import java.io.IOException;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class ImageFileValidatorTest {
    @TempDir Path temporaryDirectory;

    @Test
    void validStaticFormatsAreAccepted() throws Exception {
        ImageFileValidator validator = new ImageFileValidator();
        for (var image :
                new Object[][] {
                    {"jpeg", FileFormat.JPEG, ValidationTestSupport.image("jpeg", 2, 2)},
                    {"png", FileFormat.PNG, ValidationTestSupport.image("png", 2, 2)},
                    {"gif", FileFormat.GIF, ValidationTestSupport.image("gif", 2, 2)},
                    {"static.webp", FileFormat.WEBP, ValidationTestSupport.fixture("static.webp")}
                }) {
            try (ValidationTestSupport.StagedFixture fixture =
                    ValidationTestSupport.stage(
                            temporaryDirectory.resolve(image[0].toString()), (byte[]) image[2])) {
                assertThat(validator.validate(fixture.file()).format()).isEqualTo(image[1]);
            }
        }
    }

    @Test
    void validAnimatedGifAndWebpAreAccepted() throws Exception {
        for (String name : new String[] {"animated.gif", "animated.webp", "animated-100.webp"}) {
            try (ValidationTestSupport.StagedFixture fixture =
                    ValidationTestSupport.stage(
                            temporaryDirectory.resolve(name),
                            ValidationTestSupport.fixture(name))) {
                assertThat(new ImageFileValidator().validate(fixture.file()).format())
                        .isEqualTo(name.endsWith("gif") ? FileFormat.GIF : FileFormat.WEBP);
            }
        }
    }

    @Test
    void truncatedOrSpoofedImageIsRejected() throws Exception {
        ImageFileValidator validator = new ImageFileValidator();
        byte[] truncated = {(byte) 0xff, (byte) 0xd8, (byte) 0xff, (byte) 0xd9};
        try (ValidationTestSupport.StagedFixture fixture =
                ValidationTestSupport.stage(temporaryDirectory.resolve("truncated"), truncated)) {
            assertThatThrownBy(() -> validator.validate(fixture.file()))
                    .isInstanceOf(IllegalArgumentException.class);
        }
        try (ValidationTestSupport.StagedFixture fixture =
                ValidationTestSupport.stage(
                        temporaryDirectory.resolve("spoof"),
                        "MZ executable".getBytes(java.nio.charset.StandardCharsets.UTF_8))) {
            assertThatThrownBy(() -> validator.validate(fixture.file()))
                    .isInstanceOf(IllegalArgumentException.class);
        }
    }

    @Test
    void dimensionsAreRejectedBeforeDecodeAllocation() throws Exception {
        byte[] oversized = oversizedPngHeader(8193, 1);
        try (ValidationTestSupport.StagedFixture fixture =
                ValidationTestSupport.stage(temporaryDirectory.resolve("large"), oversized)) {
            assertThatThrownBy(() -> new ImageFileValidator().validate(fixture.file()))
                    .isInstanceOf(IllegalArgumentException.class);
        }
    }

    @Test
    void approvedDimensionBoundaryIsInclusive() throws Exception {
        for (int[] dimensions : new int[][] {{8_192, 1}, {1, 8_192}}) {
            byte[] bytes = ValidationTestSupport.image("png", dimensions[0], dimensions[1]);
            try (ValidationTestSupport.StagedFixture fixture =
                    ValidationTestSupport.stage(
                            temporaryDirectory.resolve(dimensions[0] + "x" + dimensions[1]),
                            bytes)) {
                assertThat(new ImageFileValidator().validate(fixture.file()).format())
                        .isEqualTo(FileFormat.PNG);
            }
        }
    }

    @Test
    void frameCountAndCumulativePixelsAreBounded() throws Exception {
        byte[] tooManyFrames = ValidationTestSupport.fixture("animated-101.webp");
        try (ValidationTestSupport.StagedFixture fixture =
                ValidationTestSupport.stage(temporaryDirectory.resolve("frames"), tooManyFrames)) {
            assertThatThrownBy(() -> new ImageFileValidator().validate(fixture.file()))
                    .isInstanceOf(IllegalArgumentException.class);
        }

        var limits =
                new com.krishnamurti.horizon.file.infrastructure.FileProperties().getValidation();
        limits.setMaxCumulativeImagePixels(20);
        try (ValidationTestSupport.StagedFixture fixture =
                ValidationTestSupport.stage(
                        temporaryDirectory.resolve("cumulative"),
                        ValidationTestSupport.fixture("animated.webp"))) {
            assertThatThrownBy(() -> new ImageFileValidator(limits).validate(fixture.file()))
                    .isInstanceOf(IllegalArgumentException.class);
        }
    }

    private static byte[] oversizedPngHeader(int width, int height) throws IOException {
        byte[] png = ValidationTestSupport.image("png", 1, 1);
        png[16] = (byte) (width >>> 24);
        png[17] = (byte) (width >>> 16);
        png[18] = (byte) (width >>> 8);
        png[19] = (byte) width;
        png[20] = (byte) (height >>> 24);
        png[21] = (byte) (height >>> 16);
        png[22] = (byte) (height >>> 8);
        png[23] = (byte) height;
        return png;
    }
}
