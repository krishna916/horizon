package com.krishnamurti.horizon.file.infrastructure.validation;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.krishnamurti.horizon.file.api.model.FileFormat;
import com.krishnamurti.horizon.file.infrastructure.FileProperties;
import com.krishnamurti.horizon.file.infrastructure.staging.StagingCapacity;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import org.apache.pdfbox.cos.COSDictionary;
import org.apache.pdfbox.cos.COSName;
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
            assertThat(new PdfFileValidator().validate(fixture.file(), FileFormat.PDF).format())
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
                assertThatThrownBy(
                                () ->
                                        new PdfFileValidator()
                                                .validate(fixture.file(), FileFormat.PDF))
                        .isInstanceOf(IllegalArgumentException.class);
            }
        }
    }

    @Test
    void deepPdfObjectGraphDoesNotOverflowStack() {
        COSDictionary root = new COSDictionary();
        COSDictionary current = root;
        for (int index = 0; index < 20_000; index++) {
            COSDictionary child = new COSDictionary();
            current.setItem(COSName.getPDFName("Nested"), child);
            current = child;
        }

        assertThatCode(() -> inspectGraph(root)).doesNotThrowAnyException();
    }

    @Test
    void cyclicPdfObjectGraphTerminates() {
        COSDictionary root = new COSDictionary();
        COSDictionary child = new COSDictionary();
        root.setItem(COSName.getPDFName("Child"), child);
        child.setItem(COSName.getPDFName("Parent"), root);

        assertThatCode(() -> inspectGraph(root)).doesNotThrowAnyException();
    }

    private static void inspectGraph(COSDictionary root) throws Exception {
        java.lang.reflect.Method inspect =
                PdfFileValidator.class.getDeclaredMethod(
                        "rejectActiveOrEmbeddedContent", org.apache.pdfbox.cos.COSBase.class);
        inspect.setAccessible(true);
        try {
            inspect.invoke(null, root);
        } catch (java.lang.reflect.InvocationTargetException exception) {
            Throwable cause = exception.getCause();
            if (cause instanceof Exception checked) throw checked;
            if (cause instanceof Error error) throw error;
            throw exception;
        }
    }

    @Test
    void pageAndScratchBudgetsAreEnforcedAndReleased() throws Exception {
        byte[] tooManyPages = pdfWithPages(1_001);
        try (ValidationTestSupport.StagedFixture fixture =
                ValidationTestSupport.stage(temporaryDirectory.resolve("pages"), tooManyPages)) {
            assertThatThrownBy(
                            () -> new PdfFileValidator().validate(fixture.file(), FileFormat.PDF))
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
            assertThatThrownBy(() -> validator.validate(fixture.file(), FileFormat.PDF))
                    .isInstanceOf(IllegalArgumentException.class);
            assertThat(capacity.reservedScratchBytes()).isEqualTo(128L * 1024 * 1024);
        }
        assertThat(capacity.reservedScratchBytes()).isZero();
        try (ValidationTestSupport.StagedFixture fixture =
                ValidationTestSupport.stage(temporaryDirectory.resolve("released"), valid)) {
            assertThat(
                            new PdfFileValidator(properties.getValidation(), capacity)
                                    .validate(fixture.file(), FileFormat.PDF)
                                    .format())
                    .isEqualTo(FileFormat.PDF);
            assertThat(capacity.reservedScratchBytes()).isZero();
        }
    }

    @Test
    void fourConcurrentPdfValidationsRespectScratchAdmissionAndRelease() throws Exception {
        FileProperties properties = new FileProperties();
        StagingCapacity capacity = new StagingCapacity(properties);
        PdfFileValidator validator = new PdfFileValidator(properties.getValidation(), capacity);
        try (ValidationTestSupport.StagedFixture fixture =
                        ValidationTestSupport.stage(
                                temporaryDirectory.resolve("concurrent"), pdfWithPages(1_000));
                var executor = Executors.newFixedThreadPool(4)) {
            CountDownLatch ready = new CountDownLatch(4);
            CountDownLatch start = new CountDownLatch(1);
            var results = new ArrayList<java.util.concurrent.Future<Boolean>>();
            for (int index = 0; index < 4; index++) {
                results.add(
                        executor.submit(
                                () -> {
                                    ready.countDown();
                                    if (!start.await(5, TimeUnit.SECONDS)) {
                                        throw new AssertionError(
                                                "PDF validation start gate timed out");
                                    }
                                    try {
                                        assertThat(
                                                        validator
                                                                .validate(
                                                                        fixture.file(),
                                                                        FileFormat.PDF)
                                                                .format())
                                                .isEqualTo(FileFormat.PDF);
                                        return true;
                                    } catch (IllegalArgumentException rejected) {
                                        if ("PDF parser scratch capacity is exhausted"
                                                .equals(rejected.getMessage())) {
                                            return false;
                                        }
                                        throw rejected;
                                    }
                                }));
            }
            assertThat(ready.await(5, TimeUnit.SECONDS)).isTrue();
            start.countDown();
            int accepted = 0;
            for (var result : results) {
                if (result.get(30, TimeUnit.SECONDS)) accepted++;
            }
            assertThat(accepted).isBetween(1, 4);
        }
        assertThat(capacity.reservedScratchBytes()).isZero();
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
