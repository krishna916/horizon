package com.krishnamurti.horizon.file.infrastructure.validation;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.krishnamurti.horizon.file.api.model.FileFormat;
import com.krishnamurti.horizon.file.infrastructure.FileProperties;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class OfficeFileValidatorTest {
    @TempDir Path temporaryDirectory;

    @Test
    void validDocxPackageIsAccepted() throws Exception {
        try (ValidationTestSupport.StagedFixture fixture =
                ValidationTestSupport.stage(
                        temporaryDirectory.resolve("docx"),
                        officePackage(
                                "word/document.xml",
                                "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"))) {
            assertThat(new OfficeFileValidator().validate(fixture.file(), FileFormat.DOCX).format())
                    .isEqualTo(FileFormat.DOCX);
        }
    }

    @Test
    void validDocxXlsxAndPptxPackagesAreAccepted() throws Exception {
        Object[][] formats = {
            {
                "word/document.xml",
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml",
                FileFormat.DOCX
            },
            {
                "xl/workbook.xml",
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml",
                FileFormat.XLSX
            },
            {
                "ppt/presentation.xml",
                "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml",
                FileFormat.PPTX
            }
        };
        for (Object[] item : formats) {
            try (ValidationTestSupport.StagedFixture fixture =
                    ValidationTestSupport.stage(
                            temporaryDirectory.resolve(item[2].toString()),
                            officePackage(item[0].toString(), item[1].toString()))) {
                assertThat(
                                new OfficeFileValidator()
                                        .validate(fixture.file(), (FileFormat) item[2])
                                        .format())
                        .isEqualTo(item[2]);
            }
        }
    }

    @Test
    void configuredOfficeEntryCountIsEnforced() throws Exception {
        Map<String, byte[]> packageEntries =
                officeEntries(
                        "word/document.xml",
                        "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml");
        FileProperties.Validation limits = new FileProperties().getValidation();
        limits.setMaxOfficeEntries(2);
        try (ValidationTestSupport.StagedFixture fixture =
                ValidationTestSupport.stage(
                        temporaryDirectory.resolve("entry-count"),
                        ValidationTestSupport.zip(packageEntries))) {
            assertThatThrownBy(
                            () ->
                                    new OfficeFileValidator(limits)
                                            .validate(fixture.file(), FileFormat.DOCX))
                    .isInstanceOf(IllegalArgumentException.class);
        }
    }

    @Test
    void wrongPackageAndMacroContentAreRejected() throws Exception {
        byte[] wrong =
                officePackage(
                        "xl/workbook.xml",
                        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml",
                        "<document"
                            + " xmlns=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\"/>");
        byte[] macro =
                officePackage(
                        "word/document.xml",
                        "application/vnd.ms-word.document.macroEnabled.main+xml");
        try (ValidationTestSupport.StagedFixture fixture =
                ValidationTestSupport.stage(temporaryDirectory.resolve("wrong-root"), wrong)) {
            assertThatThrownBy(
                            () ->
                                    new OfficeFileValidator()
                                            .validate(fixture.file(), FileFormat.DOCX))
                    .isInstanceOf(IllegalArgumentException.class);
        }
        try (ValidationTestSupport.StagedFixture fixture =
                ValidationTestSupport.stage(temporaryDirectory.resolve("macro-root"), macro)) {
            assertThatThrownBy(
                            () ->
                                    new OfficeFileValidator()
                                            .validate(fixture.file(), FileFormat.DOCX))
                    .isInstanceOf(IllegalArgumentException.class);
        }
    }

    @Test
    void externalNonHyperlinkPartRelationshipIsRejected() throws Exception {
        Map<String, byte[]> entries =
                officeEntries(
                        "word/document.xml",
                        "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml");
        entries.put(
                "word/_rels/document.xml.rels",
                ("<Relationships"
                     + " xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"><Relationship"
                     + " Id=\"rId1\""
                     + " Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/image\""
                     + " Target=\"http://127.0.0.1:1/must-not-fetch\" TargetMode=\"External\"/>"
                     + "</Relationships>")
                        .getBytes(StandardCharsets.UTF_8));
        try (ValidationTestSupport.StagedFixture fixture =
                ValidationTestSupport.stage(
                        temporaryDirectory.resolve("external-part-target"),
                        ValidationTestSupport.zip(entries))) {
            assertThatThrownBy(
                            () ->
                                    new OfficeFileValidator()
                                            .validate(fixture.file(), FileFormat.DOCX))
                    .isInstanceOf(IllegalArgumentException.class);
        }
    }

    @Test
    void disguisedEmbeddedExecutableIsRejectedByContent() throws Exception {
        Map<String, byte[]> entries =
                officeEntries(
                        "word/document.xml",
                        "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml");
        entries.put("word/embeddings/object.bin", new byte[] {'M', 'Z', 0, 0, 1});
        try (ValidationTestSupport.StagedFixture fixture =
                ValidationTestSupport.stage(
                        temporaryDirectory.resolve("disguised-executable"),
                        ValidationTestSupport.zip(entries))) {
            assertThatThrownBy(
                            () ->
                                    new OfficeFileValidator()
                                            .validate(fixture.file(), FileFormat.DOCX))
                    .isInstanceOf(IllegalArgumentException.class);
        }
    }

    @Test
    void traversalPackagePathIsRejected() throws Exception {
        Map<String, byte[]> entries =
                officeEntries(
                        "word/document.xml",
                        "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml");
        entries.put("../evil", new byte[] {1});
        try (ValidationTestSupport.StagedFixture fixture =
                ValidationTestSupport.stage(
                        temporaryDirectory.resolve("traversal"),
                        ValidationTestSupport.zip(entries))) {
            assertThatThrownBy(
                            () ->
                                    new OfficeFileValidator()
                                            .validate(fixture.file(), FileFormat.DOCX))
                    .isInstanceOf(IllegalArgumentException.class);
        }
    }

    @Test
    void duplicatePathsExternalEntitiesAndExecutableEntriesAreRejected() throws Exception {
        Map<String, byte[]> valid =
                officeEntries(
                        "word/document.xml",
                        "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml");
        valid.put("word/media/a", new byte[] {1});
        valid.put("word/media/b", new byte[] {2});
        byte[] duplicatePaths = ValidationTestSupport.zip(valid);
        replaceAscii(duplicatePaths, "word/media/b", "word/media/a");
        try (ValidationTestSupport.StagedFixture fixture =
                ValidationTestSupport.stage(
                        temporaryDirectory.resolve("duplicate"), duplicatePaths)) {
            assertThatThrownBy(
                            () ->
                                    new OfficeFileValidator()
                                            .validate(fixture.file(), FileFormat.DOCX))
                    .isInstanceOf(IllegalArgumentException.class);
        }

        valid.put(
                "customXml/item1.xml",
                "<!DOCTYPE x [<!ENTITY e SYSTEM \"file:///etc/passwd\">]><x>&e;</x>"
                        .getBytes(StandardCharsets.UTF_8));
        try (ValidationTestSupport.StagedFixture fixture =
                ValidationTestSupport.stage(
                        temporaryDirectory.resolve("xxe"), ValidationTestSupport.zip(valid))) {
            assertThatThrownBy(
                            () ->
                                    new OfficeFileValidator()
                                            .validate(fixture.file(), FileFormat.DOCX))
                    .isInstanceOf(IllegalArgumentException.class);
        }

        valid =
                officeEntries(
                        "word/document.xml",
                        "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml");
        valid.put("word/embeddings/evil.exe", new byte[] {0x4d, 0x5a});
        try (ValidationTestSupport.StagedFixture fixture =
                ValidationTestSupport.stage(
                        temporaryDirectory.resolve("executable"),
                        ValidationTestSupport.zip(valid))) {
            assertThatThrownBy(
                            () ->
                                    new OfficeFileValidator()
                                            .validate(fixture.file(), FileFormat.DOCX))
                    .isInstanceOf(IllegalArgumentException.class);
        }
    }

    @Test
    void ordinaryExternalHyperlinkIsKeptAsMetadataWithoutFetchingIt() throws Exception {
        Map<String, byte[]> entries =
                officeEntries(
                        "word/document.xml",
                        "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml");
        String relationships = new String(entries.get("_rels/.rels"), StandardCharsets.UTF_8);
        relationships =
                relationships.replace(
                        "</Relationships>",
                        "<Relationship Id=\"rId2\""
                            + " Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink\""
                            + " Target=\"http://127.0.0.1:1/must-not-fetch\""
                            + " TargetMode=\"External\"/></Relationships>");
        entries.put("_rels/.rels", relationships.getBytes(StandardCharsets.UTF_8));
        try (ValidationTestSupport.StagedFixture fixture =
                ValidationTestSupport.stage(
                        temporaryDirectory.resolve("hyperlink"),
                        ValidationTestSupport.zip(entries))) {
            assertThat(new OfficeFileValidator().validate(fixture.file(), FileFormat.DOCX).format())
                    .isEqualTo(FileFormat.DOCX);
        }
    }

    @Test
    void archiveExpandedEntryAndTotalBoundsAreEnforcedFromActualBytes() throws Exception {
        Map<String, byte[]> tooLargeEntry =
                officeEntries(
                        "word/document.xml",
                        "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml");
        tooLargeEntry.put("word/media/large.bin", new byte[32 * 1024 * 1024 + 1]);
        try (ValidationTestSupport.StagedFixture fixture =
                ValidationTestSupport.stage(
                        temporaryDirectory.resolve("entry-bound"),
                        ValidationTestSupport.zip(tooLargeEntry))) {
            assertThatThrownBy(
                            () ->
                                    new OfficeFileValidator()
                                            .validate(fixture.file(), FileFormat.DOCX))
                    .isInstanceOf(IllegalArgumentException.class);
        }

        FileProperties.Validation smallEntryLimit = new FileProperties().getValidation();
        smallEntryLimit.setMaxOfficeEntrySize(
                org.springframework.util.unit.DataSize.ofBytes(1_000_000));
        Map<String, byte[]> falseHeader =
                officeEntries(
                        "word/document.xml",
                        "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml");
        falseHeader.put("word/media/reported-small.bin", new byte[2 * 1024 * 1024]);
        byte[] falseHeaderZip = ValidationTestSupport.zip(falseHeader);
        setZipEntryUncompressedSize(falseHeaderZip, "word/media/reported-small.bin", 1);
        try (ValidationTestSupport.StagedFixture fixture =
                ValidationTestSupport.stage(
                        temporaryDirectory.resolve("false-header"), falseHeaderZip)) {
            assertThatThrownBy(
                            () ->
                                    new OfficeFileValidator(smallEntryLimit)
                                            .validate(fixture.file(), FileFormat.DOCX))
                    .isInstanceOf(IllegalArgumentException.class)
                    .hasMessageContaining("expanded content exceeds");
        }

        FileProperties.Validation limits = new FileProperties().getValidation();
        limits.setMaxOfficeExpandedSize(org.springframework.util.unit.DataSize.ofBytes(1_000));
        Map<String, byte[]> totalOver =
                officeEntries(
                        "word/document.xml",
                        "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml");
        totalOver.put("word/media/extra.txt", new byte[2_000]);
        try (ValidationTestSupport.StagedFixture fixture =
                ValidationTestSupport.stage(
                        temporaryDirectory.resolve("total-bound"),
                        ValidationTestSupport.zip(totalOver))) {
            assertThatThrownBy(
                            () ->
                                    new OfficeFileValidator(limits)
                                            .validate(fixture.file(), FileFormat.DOCX))
                    .isInstanceOf(IllegalArgumentException.class);
        }

        Map<String, byte[]> highlyCompressed =
                officeEntries(
                        "word/document.xml",
                        "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml");
        highlyCompressed.put("word/media/repeated.bin", new byte[200 * 1024]);
        try (ValidationTestSupport.StagedFixture fixture =
                ValidationTestSupport.stage(
                        temporaryDirectory.resolve("ratio"),
                        ValidationTestSupport.zip(highlyCompressed))) {
            assertThatThrownBy(
                            () ->
                                    new OfficeFileValidator()
                                            .validate(fixture.file(), FileFormat.DOCX))
                    .isInstanceOf(IllegalArgumentException.class);
        }
    }

    private static byte[] officePackage(String mainPart, String contentType) throws Exception {
        return ValidationTestSupport.zip(officeEntries(mainPart, contentType));
    }

    private static byte[] officePackage(String mainPart, String contentType, String mainXml)
            throws Exception {
        Map<String, byte[]> entries = officeEntries(mainPart, contentType);
        entries.put(mainPart, mainXml.getBytes(StandardCharsets.UTF_8));
        return ValidationTestSupport.zip(entries);
    }

    private static void replaceAscii(byte[] bytes, String from, String to) {
        byte[] source = from.getBytes(StandardCharsets.UTF_8);
        byte[] replacement = to.getBytes(StandardCharsets.UTF_8);
        if (source.length != replacement.length) {
            throw new IllegalArgumentException("Replacement names must have equal lengths");
        }
        boolean replaced = false;
        for (int start = 0; start <= bytes.length - source.length; start++) {
            boolean matches = true;
            for (int index = 0; index < source.length; index++) {
                matches &= bytes[start + index] == source[index];
            }
            if (matches) {
                System.arraycopy(replacement, 0, bytes, start, replacement.length);
                replaced = true;
                start += source.length - 1;
            }
        }
        if (!replaced) {
            throw new IllegalArgumentException("Name not found in ZIP");
        }
    }

    private static void setZipEntryUncompressedSize(byte[] zip, String name, int size) {
        byte[] expected = name.getBytes(StandardCharsets.UTF_8);
        boolean changed = false;
        for (int offset = 0; offset < zip.length - 30; offset++) {
            long signature = Integer.toUnsignedLong(littleEndian32(zip, offset));
            int nameLengthOffset;
            int nameOffset;
            int sizeOffset;
            if (signature == 0x04034b50L) {
                nameLengthOffset = offset + 26;
                nameOffset = offset + 30;
                sizeOffset = offset + 22;
            } else if (signature == 0x02014b50L) {
                nameLengthOffset = offset + 28;
                nameOffset = offset + 46;
                sizeOffset = offset + 24;
            } else {
                continue;
            }
            int nameLength = littleEndian16(zip, nameLengthOffset);
            if (nameLength == expected.length
                    && nameOffset + nameLength <= zip.length
                    && java.util.Arrays.equals(
                            java.util.Arrays.copyOfRange(zip, nameOffset, nameOffset + nameLength),
                            expected)) {
                zip[sizeOffset] = (byte) size;
                zip[sizeOffset + 1] = (byte) (size >>> 8);
                zip[sizeOffset + 2] = (byte) (size >>> 16);
                zip[sizeOffset + 3] = (byte) (size >>> 24);
                changed = true;
            }
        }
        if (!changed) {
            throw new IllegalArgumentException("ZIP entry headers not found: " + name);
        }
    }

    private static int littleEndian32(byte[] bytes, int offset) {
        return (bytes[offset] & 0xff)
                | ((bytes[offset + 1] & 0xff) << 8)
                | ((bytes[offset + 2] & 0xff) << 16)
                | ((bytes[offset + 3] & 0xff) << 24);
    }

    private static int littleEndian16(byte[] bytes, int offset) {
        return (bytes[offset] & 0xff) | ((bytes[offset + 1] & 0xff) << 8);
    }

    private static Map<String, byte[]> officeEntries(String mainPart, String contentType) {
        Map<String, byte[]> entries = new LinkedHashMap<>();
        entries.put(
                "[Content_Types].xml",
                ("<?xml version=\"1.0\"?><Types"
                     + " xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\"><Default"
                     + " Extension=\"rels\""
                     + " ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/><Override"
                     + " PartName=\"/"
                                + mainPart
                                + "\" ContentType=\""
                                + contentType
                                + "\"/></Types>")
                        .getBytes(StandardCharsets.UTF_8));
        entries.put(
                "_rels/.rels",
                ("<?xml version=\"1.0\"?><Relationships"
                     + " xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"><Relationship"
                     + " Id=\"rId1\""
                     + " Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\""
                     + " Target=\""
                                + mainPart
                                + "\"/></Relationships>")
                        .getBytes(StandardCharsets.UTF_8));
        String rootXml =
                switch (mainPart) {
                    case "word/document.xml" ->
                            "<?xml version=\"1.0\"?><w:document"
                                + " xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\"/>";
                    case "xl/workbook.xml" ->
                            "<?xml version=\"1.0\"?><workbook"
                                + " xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\"/>";
                    case "ppt/presentation.xml" ->
                            "<?xml version=\"1.0\"?><p:presentation"
                                + " xmlns:p=\"http://schemas.openxmlformats.org/presentationml/2006/main\"/>";
                    default -> throw new IllegalArgumentException("Unknown Office main part");
                };
        entries.put(mainPart, rootXml.getBytes(StandardCharsets.UTF_8));
        return entries;
    }
}
