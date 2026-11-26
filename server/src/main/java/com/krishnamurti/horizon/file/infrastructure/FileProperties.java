package com.krishnamurti.horizon.file.infrastructure;

import edu.umd.cs.findbugs.annotations.SuppressFBWarnings;
import jakarta.annotation.PostConstruct;
import java.time.Duration;
import java.util.Objects;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;
import org.springframework.util.unit.DataSize;

@Component
@ConfigurationProperties("horizon.file")
@SuppressFBWarnings(
        value = "EI_EXPOSE_REP",
        justification =
                "Mutable nested objects are intentionally exposed to Spring Boot configuration"
                        + " binding.")
public class FileProperties {

    public static final long DEFAULT_MAX_FILE_SIZE_BYTES = 20_971_519L;
    public static final long HARD_MAX_FILE_SIZE_BYTES = 104_857_600L;

    private DataSize maxFileSize = DataSize.ofBytes(DEFAULT_MAX_FILE_SIZE_BYTES);
    private Duration unclaimedExpiry = Duration.ofHours(24);
    private final Staging staging = new Staging();
    private final Validation validation = new Validation();
    private final Storage storage = new Storage();

    public DataSize getMaxFileSize() {
        return maxFileSize;
    }

    public void setMaxFileSize(DataSize maxFileSize) {
        this.maxFileSize = Objects.requireNonNull(maxFileSize);
    }

    public long getMaxFileSizeBytes() {
        return maxFileSize.toBytes();
    }

    public Duration getUnclaimedExpiry() {
        return unclaimedExpiry;
    }

    public void setUnclaimedExpiry(Duration unclaimedExpiry) {
        this.unclaimedExpiry = Objects.requireNonNull(unclaimedExpiry);
    }

    public Staging getStaging() {
        return staging;
    }

    public Validation getValidation() {
        return validation;
    }

    public Storage getStorage() {
        return storage;
    }

    @PostConstruct
    public void validate() {
        long maximum = getMaxFileSizeBytes();
        if (maximum <= 0 || maximum > HARD_MAX_FILE_SIZE_BYTES) {
            throw new IllegalStateException(
                    "horizon.file.max-file-size must be between 1B and 100MiB");
        }
        if (unclaimedExpiry == null || unclaimedExpiry.isZero() || unclaimedExpiry.isNegative()) {
            throw new IllegalStateException("horizon.file.unclaimed-expiry must be positive");
        }
        if (staging.maxConcurrentTransfers <= 0 || staging.copyBufferSize <= 0) {
            throw new IllegalStateException(
                    "File staging concurrency and buffer size must be positive");
        }
        long capacity = staging.effectiveMaxTotalSizeBytes(maximum);
        if (capacity < maximum) {
            throw new IllegalStateException(
                    "File staging capacity must fit at least one maximum-size file");
        }
        validation.validate();
        storage.s3.validate();
    }

    public static class Staging {
        private String directory = "./data/file-staging";
        private int maxConcurrentTransfers = 4;
        private int copyBufferSize = 65_536;
        private DataSize maxTotalSize;

        public String getDirectory() {
            return directory;
        }

        public void setDirectory(String directory) {
            this.directory = directory;
        }

        public int getMaxConcurrentTransfers() {
            return maxConcurrentTransfers;
        }

        public void setMaxConcurrentTransfers(int maxConcurrentTransfers) {
            this.maxConcurrentTransfers = maxConcurrentTransfers;
        }

        public int getCopyBufferSize() {
            return copyBufferSize;
        }

        public void setCopyBufferSize(int copyBufferSize) {
            this.copyBufferSize = copyBufferSize;
        }

        public DataSize getMaxTotalSize() {
            return maxTotalSize;
        }

        public void setMaxTotalSize(DataSize maxTotalSize) {
            this.maxTotalSize = maxTotalSize;
        }

        public long effectiveMaxTotalSizeBytes(long maxFileSizeBytes) {
            return maxTotalSize == null
                    ? Math.multiplyExact(maxFileSizeBytes, maxConcurrentTransfers)
                    : maxTotalSize.toBytes();
        }
    }

    public static class Storage {
        private final S3 s3 = new S3();

        public S3 getS3() {
            return s3;
        }
    }

    public static class Validation {
        private int maxImageWidth = 8_192;
        private int maxImageHeight = 8_192;
        private long maxImagePixels = 16_000_000L;
        private int maxImageFrames = 100;
        private long maxCumulativeImagePixels = 64_000_000L;
        private int maxPdfPages = 1_000;
        private int maxOfficeEntries = 2_048;
        private DataSize maxOfficeEntrySize = DataSize.ofMegabytes(32);
        private DataSize maxOfficeExpandedSize = DataSize.ofMegabytes(128);
        private DataSize maxParserScratchSize = DataSize.ofMegabytes(128);

        public int getMaxImageWidth() {
            return maxImageWidth;
        }

        public void setMaxImageWidth(int maxImageWidth) {
            this.maxImageWidth = maxImageWidth;
        }

        public int getMaxImageHeight() {
            return maxImageHeight;
        }

        public void setMaxImageHeight(int maxImageHeight) {
            this.maxImageHeight = maxImageHeight;
        }

        public long getMaxImagePixels() {
            return maxImagePixels;
        }

        public void setMaxImagePixels(long maxImagePixels) {
            this.maxImagePixels = maxImagePixels;
        }

        public int getMaxImageFrames() {
            return maxImageFrames;
        }

        public void setMaxImageFrames(int maxImageFrames) {
            this.maxImageFrames = maxImageFrames;
        }

        public long getMaxCumulativeImagePixels() {
            return maxCumulativeImagePixels;
        }

        public void setMaxCumulativeImagePixels(long maxCumulativeImagePixels) {
            this.maxCumulativeImagePixels = maxCumulativeImagePixels;
        }

        public int getMaxPdfPages() {
            return maxPdfPages;
        }

        public void setMaxPdfPages(int maxPdfPages) {
            this.maxPdfPages = maxPdfPages;
        }

        public int getMaxOfficeEntries() {
            return maxOfficeEntries;
        }

        public void setMaxOfficeEntries(int maxOfficeEntries) {
            this.maxOfficeEntries = maxOfficeEntries;
        }

        public DataSize getMaxOfficeEntrySize() {
            return maxOfficeEntrySize;
        }

        public void setMaxOfficeEntrySize(DataSize maxOfficeEntrySize) {
            this.maxOfficeEntrySize = Objects.requireNonNull(maxOfficeEntrySize);
        }

        public DataSize getMaxOfficeExpandedSize() {
            return maxOfficeExpandedSize;
        }

        public void setMaxOfficeExpandedSize(DataSize maxOfficeExpandedSize) {
            this.maxOfficeExpandedSize = Objects.requireNonNull(maxOfficeExpandedSize);
        }

        public DataSize getMaxParserScratchSize() {
            return maxParserScratchSize;
        }

        public void setMaxParserScratchSize(DataSize maxParserScratchSize) {
            this.maxParserScratchSize = Objects.requireNonNull(maxParserScratchSize);
        }

        private void validate() {
            if (maxImageWidth <= 0
                    || maxImageWidth > 8_192
                    || maxImageHeight <= 0
                    || maxImageHeight > 8_192
                    || maxImagePixels <= 0
                    || maxImagePixels > 16_000_000L
                    || maxImageFrames <= 0
                    || maxImageFrames > 100
                    || maxCumulativeImagePixels <= 0
                    || maxCumulativeImagePixels > 64_000_000L
                    || maxPdfPages <= 0
                    || maxPdfPages > 1_000
                    || maxOfficeEntries <= 0
                    || maxOfficeEntries > 2_048
                    || maxOfficeEntrySize.toBytes() <= 0
                    || maxOfficeEntrySize.toBytes() > 33_554_432L
                    || maxOfficeExpandedSize.toBytes() <= 0
                    || maxOfficeExpandedSize.toBytes() > 134_217_728L
                    || maxParserScratchSize.toBytes() <= 0
                    || maxParserScratchSize.toBytes() > 134_217_728L) {
                throw new IllegalStateException(
                        "File validation limits must be positive and no higher than the approved"
                                + " ceilings");
            }
        }
    }

    public static class S3 {
        private String endpoint = "";
        private String region = "us-east-1";
        private String bucket = "horizon-files";
        private boolean pathStyleAccess;
        private Duration connectionTimeout = Duration.ofSeconds(5);
        private Duration socketTimeout = Duration.ofSeconds(30);
        private Duration operationTimeout = Duration.ofMinutes(5);
        private int readMaxAttempts = 3;

        public String getEndpoint() {
            return endpoint;
        }

        public void setEndpoint(String endpoint) {
            this.endpoint = endpoint;
        }

        public String getRegion() {
            return region;
        }

        public void setRegion(String region) {
            this.region = region;
        }

        public String getBucket() {
            return bucket;
        }

        public void setBucket(String bucket) {
            this.bucket = bucket;
        }

        public boolean isPathStyleAccess() {
            return pathStyleAccess;
        }

        public void setPathStyleAccess(boolean pathStyleAccess) {
            this.pathStyleAccess = pathStyleAccess;
        }

        public Duration getConnectionTimeout() {
            return connectionTimeout;
        }

        public void setConnectionTimeout(Duration connectionTimeout) {
            this.connectionTimeout = connectionTimeout;
        }

        public Duration getSocketTimeout() {
            return socketTimeout;
        }

        public void setSocketTimeout(Duration socketTimeout) {
            this.socketTimeout = socketTimeout;
        }

        public Duration getOperationTimeout() {
            return operationTimeout;
        }

        public void setOperationTimeout(Duration operationTimeout) {
            this.operationTimeout = operationTimeout;
        }

        public int getReadMaxAttempts() {
            return readMaxAttempts;
        }

        public void setReadMaxAttempts(int readMaxAttempts) {
            this.readMaxAttempts = readMaxAttempts;
        }

        private void validate() {
            if (bucket == null || bucket.isBlank() || region == null || region.isBlank()) {
                throw new IllegalStateException("S3 bucket and region must be configured");
            }
            if (!positive(connectionTimeout)
                    || !positive(socketTimeout)
                    || !positive(operationTimeout)
                    || readMaxAttempts <= 0) {
                throw new IllegalStateException("S3 timeouts and read attempts must be positive");
            }
            if (endpoint != null && !endpoint.isBlank()) {
                try {
                    java.net.URI uri = java.net.URI.create(endpoint);
                    if (!uri.isAbsolute()
                            || uri.getHost() == null
                            || !("http".equalsIgnoreCase(uri.getScheme())
                                    || "https".equalsIgnoreCase(uri.getScheme()))) {
                        throw new IllegalStateException(
                                "S3 endpoint must be an absolute HTTP(S) URL");
                    }
                } catch (IllegalArgumentException e) {
                    throw new IllegalStateException(
                            "S3 endpoint must be an absolute HTTP(S) URL", e);
                }
            }
        }

        private static boolean positive(Duration duration) {
            return duration != null && !duration.isZero() && !duration.isNegative();
        }
    }
}
