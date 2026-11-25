package com.krishnamurti.horizon.file.infrastructure.validation;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.krishnamurti.horizon.file.api.model.FileFormat;
import com.krishnamurti.horizon.file.infrastructure.FileProperties;
import com.krishnamurti.horizon.file.infrastructure.staging.StagingCapacity;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.PDPage;
import org.apache.pdfbox.pdmodel.encryption.AccessPermission;
import org.apache.pdfbox.pdmodel.encryption.StandardProtectionPolicy;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class PdfFileValidatorTest {
    @TempDir Path temporaryDirectory;

    @Test
    void validPdfIsAccepted() throws Exception {
        try (ValidationTestSupport.StagedFixture fixture =
                ValidationTestSupport.stage(temporaryDirectory.resolve("valid"), minimalPdf(""))) {
            assertThat(new PdfFileValidator().validate(fixture.file()).format())
                    .isEqualTo(FileFormat.PDF);
        }
    }

    @Test
    void malformedAndActivePdfAreRejected() throws Exception {
        for (byte[] bytes :
                new byte[][] {
                    "%PDF-1.7\ntruncated".getBytes(StandardCharsets.US_ASCII),
                    minimalPdf("/OpenAction << /S /JavaScript /JS (x) >>"),
                    encryptedPdf()
                }) {
            try (ValidationTestSupport.StagedFixture fixture =
                    ValidationTestSupport.stage(
                            temporaryDirectory.resolve(java.util.UUID.randomUUID().toString()),
                            bytes)) {
                assertThatThrownBy(() -> new PdfFileValidator().validate(fixture.file()))
                        .isInstanceOf(IllegalArgumentException.class);
            }
        }
    }

    @Test
    void pageAndScratchBudgetsAreEnforcedAndReleased() throws Exception {
        byte[] tooManyPages = pdfWithPages(1_001);
        try (ValidationTestSupport.StagedFixture fixture =
                ValidationTestSupport.stage(temporaryDirectory.resolve("pages"), tooManyPages)) {
            assertThatThrownBy(() -> new PdfFileValidator().validate(fixture.file()))
                    .isInstanceOf(IllegalArgumentException.class);
        }

        FileProperties properties = new FileProperties();
        properties.getStaging().setMaxConcurrentTransfers(1);
        StagingCapacity capacity = new StagingCapacity(properties);
        byte[] valid = minimalPdf("");
        try (ValidationTestSupport.StagedFixture fixture =
                        ValidationTestSupport.stage(temporaryDirectory.resolve("scratch"), valid);
                StagingCapacity.ScratchReservation occupied =
                        capacity.reserveScratch(128L * 1024 * 1024)) {
            PdfFileValidator validator = new PdfFileValidator(properties.getValidation(), capacity);
            assertThatThrownBy(() -> validator.validate(fixture.file()))
                    .isInstanceOf(IllegalArgumentException.class);
            assertThat(capacity.reservedScratchBytes()).isEqualTo(128L * 1024 * 1024);
        }
        assertThat(capacity.reservedScratchBytes()).isZero();
        try (ValidationTestSupport.StagedFixture fixture =
                ValidationTestSupport.stage(temporaryDirectory.resolve("released"), valid)) {
            assertThat(
                            new PdfFileValidator(properties.getValidation(), capacity)
                                    .validate(fixture.file())
                                    .format())
                    .isEqualTo(FileFormat.PDF);
            assertThat(capacity.reservedScratchBytes()).isZero();
        }
    }

    private static byte[] encryptedPdf() throws Exception {
        try (PDDocument document = new PDDocument();
                ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            document.addPage(new PDPage());
            StandardProtectionPolicy policy =
                    new StandardProtectionPolicy(
                            "owner-secret", "user-secret", new AccessPermission());
            policy.setEncryptionKeyLength(128);
            document.protect(policy);
            document.save(output);
            return output.toByteArray();
        }
    }

    private static byte[] pdfWithPages(int pageCount) throws Exception {
        try (PDDocument document = new PDDocument();
                ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            for (int index = 0; index < pageCount; index++) {
                document.addPage(new PDPage());
            }
            document.save(output);
            return output.toByteArray();
        }
    }

    private static byte[] minimalPdf(String extraCatalogEntry) {
        String[] objects = {
            "<< /Type /Catalog /Pages 2 0 R " + extraCatalogEntry + " >>",
            "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
            "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 10 10] /Resources << >> /Contents 4 0 R"
                    + " >>",
            "<< /Length 0 >>\nstream\n\nendstream"
        };
        StringBuilder pdf = new StringBuilder("%PDF-1.4\n");
        int[] offsets = new int[objects.length + 1];
        for (int index = 0; index < objects.length; index++) {
            offsets[index + 1] = pdf.length();
            pdf.append(index + 1).append(" 0 obj\n").append(objects[index]).append("\nendobj\n");
        }
        int xref = pdf.length();
        pdf.append("xref\n0 ").append(offsets.length).append("\n0000000000 65535 f \n");
        for (int index = 1; index < offsets.length; index++) {
            pdf.append(String.format(java.util.Locale.ROOT, "%010d 00000 n \n", offsets[index]));
        }
        pdf.append("trailer\n<< /Size ")
                .append(offsets.length)
                .append(" /Root 1 0 R >>\nstartxref\n")
                .append(xref)
                .append("\n%%EOF\n");
        return pdf.toString().getBytes(StandardCharsets.US_ASCII);
    }
}
