package com.krishnamurti.horizon.file.infrastructure;

import jakarta.annotation.PostConstruct;
import java.time.Duration;
import java.util.Objects;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;
import org.springframework.util.unit.DataSize;

@Component
@ConfigurationProperties("horizon.file")
public class FileProperties {

    public static final long DEFAULT_MAX_FILE_SIZE_BYTES = 20_971_519L;
    public static final long HARD_MAX_FILE_SIZE_BYTES = 104_857_600L;

    private DataSize maxFileSize = DataSize.ofBytes(DEFAULT_MAX_FILE_SIZE_BYTES);
    private Duration unclaimedExpiry = Duration.ofHours(24);
    private final Staging staging = new Staging();
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
    }
}
