package com.krishnamurti.horizon.file.infrastructure.validation;

import com.krishnamurti.horizon.file.api.model.FileFormat;
import com.krishnamurti.horizon.file.infrastructure.FileProperties;
import com.krishnamurti.horizon.file.infrastructure.staging.StagedFile;
import java.awt.image.BufferedImage;
import java.io.DataInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.file.Files;
import java.util.Iterator;
import javax.imageio.ImageIO;
import javax.imageio.ImageReader;
import javax.imageio.stream.ImageInputStream;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

@Component
public class ImageFileValidator implements FileValidator {
    private final FileProperties.Validation limits;

    @Autowired
    public ImageFileValidator(FileProperties properties) {
        this(properties.getValidation());
    }

    ImageFileValidator(FileProperties.Validation limits) {
        this.limits = limits;
    }

    public ImageFileValidator() {
        this(new FileProperties().getValidation());
    }

    @Override
    public boolean supports(FileFormat format) {
        return format == FileFormat.JPEG
                || format == FileFormat.PNG
                || format == FileFormat.WEBP
                || format == FileFormat.GIF;
    }

    @Override
    public ValidationResult validate(StagedFile stagedFile) throws IOException {
        try (ImageInputStream input = ImageIO.createImageInputStream(stagedFile.path().toFile())) {
            if (input == null) {
                throw invalid("Unsupported or malformed image");
            }
            Iterator<ImageReader> readers = ImageIO.getImageReaders(input);
            if (!readers.hasNext()) {
                throw invalid("Unsupported or malformed image");
            }
            ImageReader reader = readers.next();
            try {
                reader.setInput(input, false, false);
                FileFormat format = imageFormat(reader.getFormatName());
                ContainerSummary summary =
                        format == FileFormat.WEBP
                                ? webpSummary(stagedFile)
                                : format == FileFormat.GIF ? gifSummary(stagedFile) : null;
                int canvasWidth =
                        summary == null || summary.width() <= 0
                                ? reader.getWidth(0)
                                : summary.width();
                int canvasHeight =
                        summary == null || summary.height() <= 0
                                ? reader.getHeight(0)
                                : summary.height();
                if (summary != null && summary.frames() > 0 && summary.width() <= 0) {
                    throw invalid("Animated WebP is missing its extended canvas header");
                }
                checkDimensions(canvasWidth, canvasHeight);
                if (summary != null && summary.frames() > limits.getMaxImageFrames()) {
                    throw invalid("Image frame count exceeds the approved limit");
                }
                int frames = reader.getNumImages(true);
                if (frames < 1 || frames > limits.getMaxImageFrames()) {
                    throw invalid("Image frame count exceeds the approved limit");
                }
                if (summary != null && summary.frames() > 0 && frames != summary.frames()) {
                    throw invalid("Image frame index is inconsistent with its container");
                }
                if (frames > 1 && format != FileFormat.GIF && format != FileFormat.WEBP) {
                    throw invalid("Animated content is not supported for this image format");
                }
                long cumulativePixels = 0;
                for (int frame = 0; frame < frames; frame++) {
                    int width = reader.getWidth(frame);
                    int height = reader.getHeight(frame);
                    checkDimensions(width, height);
                    long pixels = Math.multiplyExact((long) width, height);
                    cumulativePixels = Math.addExact(cumulativePixels, pixels);
                    if (cumulativePixels > limits.getMaxCumulativeImagePixels()) {
                        throw invalid("Decoded image pixels exceed the approved cumulative limit");
                    }
                    BufferedImage decoded = reader.read(frame);
                    if (decoded == null
                            || decoded.getWidth() != width
                            || decoded.getHeight() != height) {
                        throw invalid("Image frame is truncated or malformed");
                    }
                    decoded.flush();
                }
                return new ValidationResult(format, mediaType(format));
            } catch (ArithmeticException | IndexOutOfBoundsException exception) {
                throw invalid("Image dimensions are invalid", exception);
            } finally {
                reader.dispose();
            }
        } catch (IllegalArgumentException exception) {
            throw exception;
        } catch (IOException exception) {
            throw invalid("Image structure is malformed or truncated", exception);
        } catch (RuntimeException exception) {
            throw invalid("Image structure is malformed", exception);
        }
    }

    private void checkDimensions(int width, int height) {
        if (width <= 0
                || height <= 0
                || width > limits.getMaxImageWidth()
                || height > limits.getMaxImageHeight()
                || Math.multiplyExact((long) width, height) > limits.getMaxImagePixels()) {
            throw invalid("Image dimensions exceed the approved limit");
        }
    }

    private ContainerSummary webpSummary(StagedFile file) throws IOException {
        long fileSize = Files.size(file.path());
        try (DataInputStream input = new DataInputStream(Files.newInputStream(file.path()))) {
            byte[] riff = readExact(input, 12);
            ByteBuffer header = ByteBuffer.wrap(riff).order(ByteOrder.LITTLE_ENDIAN);
            if (header.getInt(0) != 0x46464952
                    || header.getInt(8) != 0x50424557
                    || Integer.toUnsignedLong(header.getInt(4)) + 8 != fileSize) {
                throw invalid("Invalid WebP RIFF header");
            }
            long offset = 12;
            int width = -1;
            int height = -1;
            int frames = 0;
            while (offset < fileSize) {
                byte[] chunkHeader = readExact(input, 8);
                offset += 8;
                ByteBuffer chunk = ByteBuffer.wrap(chunkHeader).order(ByteOrder.LITTLE_ENDIAN);
                int id = chunk.getInt(0);
                long length = Integer.toUnsignedLong(chunk.getInt(4));
                long paddedLength = length + (length & 1L);
                if (paddedLength > fileSize - offset) {
                    throw invalid("Truncated WebP chunk");
                }
                if (id == 0x58385056) { // VP8X
                    if (length < 10 || width >= 0 || offset != 20) {
                        throw invalid("Invalid extended WebP header");
                    }
                    byte[] extended = readExact(input, 10);
                    width = unsigned24LittleEndian(extended, 4) + 1;
                    height = unsigned24LittleEndian(extended, 7) + 1;
                    skipFully(input, paddedLength - 10);
                } else {
                    if (id == 0x464d4e41) { // ANMF
                        frames++;
                        if (frames > limits.getMaxImageFrames()) {
                            throw invalid("Image frame count exceeds the approved limit");
                        }
                        if (length < 16) {
                            throw invalid("Invalid WebP animation frame");
                        }
                    }
                    skipFully(input, paddedLength);
                }
                offset = Math.addExact(offset, paddedLength);
            }
            if (offset != fileSize) {
                throw invalid("Invalid WebP container length");
            }
            return new ContainerSummary(width, height, frames);
        } catch (ArithmeticException exception) {
            throw invalid("WebP container length overflowed", exception);
        }
    }

    private static byte[] readExact(InputStream input, int length) throws IOException {
        byte[] bytes = input.readNBytes(length);
        if (bytes.length != length) {
            throw invalid("Truncated image container");
        }
        return bytes;
    }

    private static void skipFully(InputStream input, long count) throws IOException {
        long remaining = count;
        byte[] buffer = new byte[1_024];
        while (remaining > 0) {
            int skipped = input.read(buffer, 0, (int) Math.min(buffer.length, remaining));
            if (skipped < 0) {
                throw invalid("Truncated image container");
            }
            remaining -= skipped;
        }
    }

    private static int unsigned24LittleEndian(byte[] bytes, int offset) {
        return (bytes[offset] & 0xff)
                | ((bytes[offset + 1] & 0xff) << 8)
                | ((bytes[offset + 2] & 0xff) << 16);
    }

    private ContainerSummary gifSummary(StagedFile file) throws IOException {
        try (GifScanner scanner =
                new GifScanner(Files.newInputStream(file.path()), file.sizeBytes())) {
            return scanner.scan(limits.getMaxImageFrames());
        }
    }

    private record ContainerSummary(int width, int height, int frames) {}

    private static final class GifScanner implements AutoCloseable {
        private final InputStream input;
        private final long fileSize;
        private long consumed;

        private GifScanner(InputStream input, long fileSize) {
            this.input = input;
            this.fileSize = fileSize;
        }

        private ContainerSummary scan(int maximumFrames) throws IOException {
            byte[] header = read(13);
            String signature = new String(header, 0, 6, java.nio.charset.StandardCharsets.US_ASCII);
            if (!signature.equals("GIF87a") && !signature.equals("GIF89a")) {
                throw invalid("Invalid GIF signature");
            }
            int width = littleEndian16(header, 6);
            int height = littleEndian16(header, 8);
            int packed = header[10] & 0xff;
            if ((packed & 0x80) != 0) {
                skip(3L * (1 << ((packed & 0x07) + 1)));
            }
            int frames = 0;
            boolean trailer = false;
            while (consumed < fileSize) {
                int marker = read(1)[0] & 0xff;
                if (marker == 0x3b) {
                    trailer = true;
                    break;
                }
                if (marker == 0x21) {
                    read(1); // extension label
                    skipSubBlocks();
                    continue;
                }
                if (marker != 0x2c) {
                    throw invalid("Invalid GIF block marker");
                }
                byte[] descriptor = read(9);
                frames++;
                if (frames > maximumFrames) {
                    throw invalid("Image frame count exceeds the approved limit");
                }
                if ((descriptor[8] & 0x80) != 0) {
                    skip(3L * (1 << ((descriptor[8] & 0x07) + 1)));
                }
                read(1); // LZW minimum code size
                skipSubBlocks();
            }
            if (!trailer || consumed != fileSize || frames == 0) {
                throw invalid("Truncated or trailing GIF data");
            }
            return new ContainerSummary(width, height, frames);
        }

        private void skipSubBlocks() throws IOException {
            while (true) {
                int size = read(1)[0] & 0xff;
                if (size == 0) {
                    return;
                }
                skip(size);
            }
        }

        private byte[] read(int count) throws IOException {
            byte[] bytes = input.readNBytes(count);
            if (bytes.length != count) {
                throw invalid("Truncated GIF data");
            }
            consumed = Math.addExact(consumed, count);
            return bytes;
        }

        private void skip(long count) throws IOException {
            if (count < 0 || count > fileSize - consumed) {
                throw invalid("Invalid GIF block length");
            }
            byte[] buffer = new byte[256];
            long remaining = count;
            while (remaining > 0) {
                int read = input.read(buffer, 0, (int) Math.min(buffer.length, remaining));
                if (read < 0) {
                    throw invalid("Truncated GIF data");
                }
                consumed = Math.addExact(consumed, read);
                remaining -= read;
            }
        }

        @Override
        public void close() throws IOException {
            input.close();
        }
    }

    private static int littleEndian16(byte[] bytes, int offset) {
        return (bytes[offset] & 0xff) | ((bytes[offset + 1] & 0xff) << 8);
    }

    private static FileFormat imageFormat(String name) {
        return switch (name.toLowerCase(java.util.Locale.ROOT)) {
            case "jpeg", "jpg" -> FileFormat.JPEG;
            case "png" -> FileFormat.PNG;
            case "gif" -> FileFormat.GIF;
            case "webp" -> FileFormat.WEBP;
            default -> throw invalid("Unsupported image signature");
        };
    }

    private static String mediaType(FileFormat format) {
        return switch (format) {
            case JPEG -> "image/jpeg";
            case PNG -> "image/png";
            case GIF -> "image/gif";
            case WEBP -> "image/webp";
            default -> throw new IllegalArgumentException("Not an image format");
        };
    }

    private static IllegalArgumentException invalid(String message) {
        return new IllegalArgumentException(message);
    }

    private static IllegalArgumentException invalid(String message, Throwable cause) {
        return new IllegalArgumentException(message, cause);
    }
}
