package com.krishnamurti.horizon.file.infrastructure.validation;

import com.krishnamurti.horizon.file.api.model.FileFormat;
import com.krishnamurti.horizon.file.infrastructure.FileProperties;
import com.krishnamurti.horizon.file.infrastructure.staging.StagedFile;
import com.krishnamurti.horizon.file.infrastructure.staging.StagingCapacity;
import java.io.IOException;
import java.util.Collections;
import java.util.IdentityHashMap;
import java.util.Map;
import java.util.Set;
import org.apache.pdfbox.cos.COSArray;
import org.apache.pdfbox.cos.COSBase;
import org.apache.pdfbox.cos.COSDictionary;
import org.apache.pdfbox.cos.COSName;
import org.apache.pdfbox.cos.COSObject;
import org.apache.pdfbox.io.MemoryUsageSetting;
import org.apache.pdfbox.io.RandomAccessReadBufferedFile;
import org.apache.pdfbox.pdfparser.PDFParser;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

@Component
public class PdfFileValidator implements FileValidator {
    private final FileProperties.Validation limits;
    private final StagingCapacity capacity;

    @Autowired
    public PdfFileValidator(FileProperties properties, StagingCapacity capacity) {
        this(properties.getValidation(), capacity);
    }

    PdfFileValidator(FileProperties.Validation limits, StagingCapacity capacity) {
        this.limits = limits;
        this.capacity = capacity;
    }

    public PdfFileValidator() {
        FileProperties properties = new FileProperties();
        this.limits = properties.getValidation();
        this.capacity = new StagingCapacity(properties);
    }

    @Override
    public boolean supports(FileFormat format) {
        return format == FileFormat.PDF;
    }

    @Override
    public ValidationResult validate(StagedFile stagedFile) throws IOException {
        long scratchLimit = limits.getMaxParserScratchSize().toBytes();
        StagingCapacity.ScratchReservation reservation = capacity.reserveScratch(scratchLimit);
        if (reservation == null) {
            throw invalid("PDF parser scratch capacity is exhausted");
        }
        try (reservation;
                RandomAccessReadBufferedFile input =
                        new RandomAccessReadBufferedFile(stagedFile.path().toFile())) {
            StrictPdfParser parser =
                    new StrictPdfParser(
                            input,
                            MemoryUsageSetting.setupMainMemoryOnly(scratchLimit).streamCache);
            try (PDDocument document = parser.parse()) {
                if (document.isEncrypted()) {
                    throw invalid("Encrypted PDF documents are not accepted");
                }
                if (document.getNumberOfPages() > limits.getMaxPdfPages()) {
                    throw invalid("PDF page count exceeds the approved limit");
                }
                rejectActiveOrEmbeddedContent(document.getDocumentCatalog().getCOSObject());
                return new ValidationResult(FileFormat.PDF, "application/pdf");
            }
        } catch (IllegalArgumentException exception) {
            throw exception;
        } catch (IOException | RuntimeException exception) {
            throw new IllegalArgumentException(
                    "PDF structure is malformed or uninspectable", exception);
        }
    }

    private static void rejectActiveOrEmbeddedContent(COSBase root) {
        Set<COSBase> visited = Collections.newSetFromMap(new IdentityHashMap<>());
        inspect(root, visited);
    }

    private static void inspect(COSBase value, Set<COSBase> visited) {
        if (value == null || !visited.add(value)) {
            return;
        }
        if (value instanceof COSObject reference) {
            inspect(reference.getObject(), visited);
        } else if (value instanceof COSArray array) {
            for (COSBase item : array) {
                inspect(item, visited);
            }
        } else if (value instanceof COSDictionary dictionary) {
            for (Map.Entry<COSName, COSBase> entry : dictionary.entrySet()) {
                String key = entry.getKey().getName();
                if (key.equals("JavaScript")
                        || key.equals("JS")
                        || key.equals("EmbeddedFiles")
                        || key.equals("EF")
                        || key.equals("RichMedia")) {
                    throw invalid("PDF active or embedded content is not accepted");
                }
                COSBase child = dereference(entry.getValue());
                if (child instanceof COSDictionary action) {
                    COSBase subtype = dereference(action.getItem(COSName.S));
                    if (COSName.JAVA_SCRIPT.equals(subtype)
                            || (subtype instanceof COSName actionType
                                    && actionType.getName().equals("Launch"))) {
                        throw invalid("PDF JavaScript and launch actions are not accepted");
                    }
                }
                inspect(entry.getValue(), visited);
            }
        }
    }

    private static COSBase dereference(COSBase value) {
        return value instanceof COSObject object ? object.getObject() : value;
    }

    private static IllegalArgumentException invalid(String message) {
        return new IllegalArgumentException(message);
    }

    private static final class StrictPdfParser extends PDFParser {
        private StrictPdfParser(
                RandomAccessReadBufferedFile input,
                org.apache.pdfbox.io.RandomAccessStreamCache.StreamCacheCreateFunction cache)
                throws IOException {
            super(input, null, null, null, cache);
            setLenient(false);
        }
    }
}
