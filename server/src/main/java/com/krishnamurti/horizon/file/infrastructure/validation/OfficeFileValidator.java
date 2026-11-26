package com.krishnamurti.horizon.file.infrastructure.validation;

import com.krishnamurti.horizon.file.api.model.FileFormat;
import com.krishnamurti.horizon.file.infrastructure.FileProperties;
import com.krishnamurti.horizon.file.infrastructure.staging.StagedFile;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.Enumeration;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;
import javax.xml.namespace.QName;
import javax.xml.stream.XMLInputFactory;
import javax.xml.stream.XMLStreamConstants;
import javax.xml.stream.XMLStreamException;
import javax.xml.stream.XMLStreamReader;
import org.apache.poi.openxml4j.opc.OPCPackage;
import org.apache.poi.openxml4j.opc.PackageAccess;
import org.apache.poi.openxml4j.opc.PackagePart;
import org.apache.poi.openxml4j.opc.PackageRelationship;
import org.apache.poi.openxml4j.opc.PackageRelationshipCollection;
import org.apache.poi.openxml4j.opc.TargetMode;
import org.apache.poi.openxml4j.util.ZipSecureFile;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

@Component
public class OfficeFileValidator implements FileValidator {
    private static final long POI_MAX_ENTRY_SIZE = 32L * 1024 * 1024;
    private static final int POI_MAX_FILE_COUNT = 2_048;
    private static final double POI_DEFAULT_MIN_INFLATE_RATIO = 0.01;
    private static final long POI_DEFAULT_GRACE_SIZE = 100L * 1024;
    private static final String OFFICE_DOCUMENT_RELATIONSHIP =
            "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument";
    private static final String PACKAGE_RELATIONSHIPS_NAMESPACE =
            "http://schemas.openxmlformats.org/package/2006/relationships";
    private final FileProperties.Validation limits;

    static {
        // These equal the approved per-entry/count limits and POI's documented 1% default ratio.
        ZipSecureFile.setMaxEntrySize(POI_MAX_ENTRY_SIZE);
        ZipSecureFile.setMaxFileCount(POI_MAX_FILE_COUNT);
        ZipSecureFile.setMinInflateRatio(POI_DEFAULT_MIN_INFLATE_RATIO);
    }

    @Autowired
    public OfficeFileValidator(FileProperties properties) {
        this(properties.getValidation());
    }

    OfficeFileValidator(FileProperties.Validation limits) {
        this.limits = limits;
    }

    public OfficeFileValidator() {
        this(new FileProperties().getValidation());
    }

    @Override
    public boolean supports(FileFormat format) {
        return format == FileFormat.DOCX || format == FileFormat.XLSX || format == FileFormat.PPTX;
    }

    @Override
    public ValidationResult validate(StagedFile stagedFile, FileFormat expectedFormat)
            throws IOException {
        if (!supports(expectedFormat)) {
            throw invalid("Requested format is not a supported Office format");
        }
        try {
            preflightZip(stagedFile);
            try (OPCPackage officePackage =
                    OPCPackage.open(stagedFile.path().toFile(), PackageAccess.READ)) {
                FileFormat format = validateRootPart(officePackage);
                if (format != expectedFormat) {
                    throw invalid("Office package type is not supported");
                }
                scanPackageParts(officePackage);
                return new ValidationResult(format, mediaType(format));
            }
        } catch (IllegalArgumentException exception) {
            throw exception;
        } catch (Exception exception) {
            throw new IllegalArgumentException("Office package is malformed or unsafe", exception);
        }
    }

    private void preflightZip(StagedFile stagedFile) throws IOException {
        Set<String> names = new HashSet<>();
        long totalExpanded = 0;
        int count = 0;
        try (ZipFile zip = new ZipFile(stagedFile.path().toFile())) {
            Enumeration<? extends ZipEntry> entries = zip.entries();
            byte[] buffer = new byte[8_192];
            while (entries.hasMoreElements()) {
                ZipEntry entry = entries.nextElement();
                count++;
                if (count > limits.getMaxOfficeEntries()) {
                    throw invalid("Office archive has too many entries");
                }
                String name = entry.getName();
                validateEntryName(name);
                if (!names.add(name)) {
                    throw invalid("Office archive contains duplicate entry names");
                }
                rejectExecutableEntryName(name);
                if (entry.isDirectory()) {
                    continue;
                }
                long expanded = 0;
                try (InputStream input = zip.getInputStream(entry)) {
                    int read;
                    while ((read = input.read(buffer)) >= 0) {
                        if (read == 0) {
                            continue;
                        }
                        expanded = Math.addExact(expanded, read);
                        totalExpanded = Math.addExact(totalExpanded, read);
                        if (expanded > limits.getMaxOfficeEntrySize().toBytes()
                                || totalExpanded > limits.getMaxOfficeExpandedSize().toBytes()) {
                            throw invalid(
                                    "Office archive expanded content exceeds the approved limit");
                        }
                    }
                }
                long compressed = entry.getCompressedSize();
                if (expanded > POI_DEFAULT_GRACE_SIZE
                        && (compressed <= 0
                                || compressed / (double) expanded
                                        < POI_DEFAULT_MIN_INFLATE_RATIO)) {
                    throw invalid(
                            "Office archive compression ratio is below Apache POI's secure"
                                    + " default");
                }
            }
            if (!names.contains("[Content_Types].xml") || !names.contains("_rels/.rels")) {
                throw invalid("Office package is missing its root content type or relationships");
            }
        } catch (ArithmeticException exception) {
            throw invalid("Office archive expanded size overflowed", exception);
        }
        scanZipXml(stagedFile);
    }

    private static void rejectExecutableEntryName(String name) {
        String lower = name.toLowerCase(Locale.ROOT);
        if (lower.endsWith("vbaproject.bin")
                || lower.endsWith(".exe")
                || lower.endsWith(".dll")
                || lower.endsWith(".com")
                || lower.endsWith(".scr")
                || lower.endsWith(".bat")
                || lower.endsWith(".cmd")) {
            throw invalid("Office macros and executable embedded objects are not accepted");
        }
    }

    private static void validateEntryName(String name) {
        if (name == null
                || name.isEmpty()
                || name.startsWith("/")
                || name.startsWith("\\")
                || name.contains("\\")
                || name.indexOf('\0') >= 0) {
            throw invalid("Office archive contains an unsafe path");
        }
        for (String segment : name.split("/", -1)) {
            if (segment.isEmpty() || segment.equals(".") || segment.equals("..")) {
                throw invalid("Office archive contains an unsafe path");
            }
        }
    }

    private static boolean isXmlEntry(String name) {
        String lower = name.toLowerCase(Locale.ROOT);
        return lower.endsWith(".xml") || lower.endsWith(".rels");
    }

    private static void scanZipXml(StagedFile stagedFile) throws IOException {
        XMLInputFactory factory = secureXmlFactory();
        try (ZipFile zip = new ZipFile(stagedFile.path().toFile())) {
            Enumeration<? extends ZipEntry> entries = zip.entries();
            while (entries.hasMoreElements()) {
                ZipEntry entry = entries.nextElement();
                if (!entry.isDirectory() && isXmlEntry(entry.getName())) {
                    try (InputStream input = zip.getInputStream(entry)) {
                        scanXml(factory, input);
                    } catch (XMLStreamException exception) {
                        throw invalid(
                                "Office XML contains invalid or external entity content",
                                exception);
                    }
                }
            }
        }
    }

    private FileFormat validateRootPart(OPCPackage officePackage) throws Exception {
        PackageRelationshipCollection relationships = officePackage.getRelationships();
        PackageRelationship officeRelationship = null;
        for (PackageRelationship relationship : relationships) {
            if (OFFICE_DOCUMENT_RELATIONSHIP.equals(relationship.getRelationshipType())) {
                if (relationship.getTargetMode() != TargetMode.INTERNAL
                        || officeRelationship != null) {
                    throw invalid("Office package has invalid document relationships");
                }
                officeRelationship = relationship;
            } else if (relationship.getTargetMode() == TargetMode.EXTERNAL
                    && !relationship.getRelationshipType().endsWith("/hyperlink")) {
                throw invalid("External Office relationships are not accepted");
            }
        }
        if (officeRelationship == null) {
            throw invalid("Office package has no internal office document part");
        }
        PackagePart mainPart = officePackage.getPart(officeRelationship);
        String name = mainPart.getPartName().getName();
        String type = mainPart.getContentType();
        FileFormat format;
        if (name.equals("/word/document.xml")
                && type.equals(
                        "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml")) {
            format = FileFormat.DOCX;
        } else if (name.equals("/xl/workbook.xml")
                && type.equals(
                        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml")) {
            format = FileFormat.XLSX;
        } else if (name.equals("/ppt/presentation.xml")
                && type.equals(
                        "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml")) {
            format = FileFormat.PPTX;
        } else {
            throw invalid("Office package root content type does not match DOCX, XLSX or PPTX");
        }
        validateMainXml(mainPart, format);
        return format;
    }

    private void scanPackageParts(OPCPackage officePackage) throws Exception {
        for (PackagePart part : officePackage.getParts()) {
            String name = part.getPartName().getName().toLowerCase(Locale.ROOT);
            String contentType = part.getContentType().toLowerCase(Locale.ROOT);
            if (name.endsWith("vbaproject.bin")
                    || name.endsWith(".exe")
                    || name.endsWith(".dll")
                    || name.endsWith(".com")
                    || name.endsWith(".scr")
                    || name.endsWith(".bat")
                    || name.endsWith(".cmd")
                    || contentType.contains("macroenabled")
                    || contentType.contains("vbaproject")
                    || contentType.contains("oleobject")) {
                throw invalid("Office macros and executable embedded objects are not accepted");
            }
            if (hasExecutableSignature(part)) {
                throw invalid("Office embedded executable content is not accepted");
            }
            if (isXmlEntry(name)
                    || contentType.endsWith("+xml")
                    || contentType.equals("application/xml")) {
                try (InputStream input = part.getInputStream()) {
                    scanXml(secureXmlFactory(), input);
                }
            }
        }
    }

    private static void validateMainXml(PackagePart mainPart, FileFormat format) throws Exception {
        QName expected =
                switch (format) {
                    case DOCX ->
                            new QName(
                                    "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
                                    "document");
                    case XLSX ->
                            new QName(
                                    "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
                                    "workbook");
                    case PPTX ->
                            new QName(
                                    "http://schemas.openxmlformats.org/presentationml/2006/main",
                                    "presentation");
                    default -> throw invalid("Office package type is not supported");
                };
        try (InputStream input = mainPart.getInputStream()) {
            XMLStreamReader reader = secureXmlFactory().createXMLStreamReader(input);
            try {
                while (reader.hasNext()) {
                    if (reader.next() == XMLStreamConstants.START_ELEMENT) {
                        if (!expected.equals(reader.getName())) {
                            throw invalid("Office main XML root does not match its package type");
                        }
                        return;
                    }
                }
                throw invalid("Office main XML has no document root");
            } finally {
                reader.close();
            }
        }
    }

    private static boolean hasExecutableSignature(PackagePart part) throws IOException {
        try (InputStream input = part.getInputStream()) {
            int first = input.read();
            int second = input.read();
            int third = input.read();
            int fourth = input.read();
            return (first == 'M' && second == 'Z')
                    || (first == 0x7f && second == 'E' && third == 'L' && fourth == 'F')
                    || (first == '#' && second == '!');
        }
    }

    private static XMLInputFactory secureXmlFactory() {
        XMLInputFactory factory = XMLInputFactory.newFactory();
        factory.setProperty(XMLInputFactory.SUPPORT_DTD, false);
        factory.setProperty(XMLInputFactory.IS_SUPPORTING_EXTERNAL_ENTITIES, false);
        factory.setProperty(XMLInputFactory.IS_REPLACING_ENTITY_REFERENCES, false);
        factory.setXMLResolver(
                (publicId, systemId, baseUri, namespace) -> {
                    throw new XMLStreamException("External XML resolution is disabled");
                });
        return factory;
    }

    private static void scanXml(XMLInputFactory factory, InputStream input)
            throws XMLStreamException {
        XMLStreamReader reader =
                factory.createXMLStreamReader(input, StandardCharsets.UTF_8.name());
        try {
            while (reader.hasNext()) {
                int event = reader.next();
                if (event == XMLStreamConstants.DTD
                        || event == XMLStreamConstants.ENTITY_REFERENCE) {
                    throw new XMLStreamException("DTD and entity references are disabled");
                }
                if (event == XMLStreamConstants.START_ELEMENT
                        && "Relationship".equals(reader.getLocalName())
                        && PACKAGE_RELATIONSHIPS_NAMESPACE.equals(reader.getNamespaceURI())) {
                    String targetMode = reader.getAttributeValue(null, "TargetMode");
                    String type = reader.getAttributeValue(null, "Type");
                    if ("External".equals(targetMode)
                            && (type == null || !type.endsWith("/hyperlink"))) {
                        throw new XMLStreamException(
                                "External Office part relationships are not accepted");
                    }
                }
            }
        } finally {
            reader.close();
        }
    }

    private static String mediaType(FileFormat format) {
        return switch (format) {
            case DOCX -> "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
            case XLSX -> "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
            case PPTX ->
                    "application/vnd.openxmlformats-officedocument.presentationml.presentation";
            default -> throw new IllegalArgumentException("Not an Office format");
        };
    }

    private static IllegalArgumentException invalid(String message) {
        return new IllegalArgumentException(message);
    }

    private static IllegalArgumentException invalid(String message, Throwable cause) {
        return new IllegalArgumentException(message, cause);
    }
}
