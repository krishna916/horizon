package com.krishnamurti.horizon.file.infrastructure.storage.s3;

import com.krishnamurti.horizon.file.infrastructure.FileProperties;
import java.net.URI;
import java.time.Duration;
import java.util.Objects;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import software.amazon.awssdk.auth.credentials.AwsCredentialsProvider;
import software.amazon.awssdk.auth.credentials.DefaultCredentialsProvider;
import software.amazon.awssdk.core.retry.RetryPolicy;
import software.amazon.awssdk.http.apache.ApacheHttpClient;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.S3ClientBuilder;

/** AWS SDK wiring is confined to the S3 infrastructure adapter. */
@Configuration(proxyBeanMethods = false)
@ConditionalOnProperty(prefix = "horizon.file.storage.s3", name = "bucket")
public class S3Configuration {

    @Bean(name = "fileS3WriteClient", destroyMethod = "close")
    S3Client fileS3WriteClient(FileProperties properties) {
        return build(properties.getStorage().getS3(), DefaultCredentialsProvider.create(), false);
    }

    @Bean(name = "fileS3ReadClient", destroyMethod = "close")
    S3Client fileS3ReadClient(FileProperties properties) {
        return build(properties.getStorage().getS3(), DefaultCredentialsProvider.create(), true);
    }

    @Bean
    S3ObjectStorage fileObjectStorage(
            FileProperties properties,
            @Qualifier("fileS3WriteClient") S3Client writeClient,
            @Qualifier("fileS3ReadClient") S3Client readClient) {
        return new S3ObjectStorage(
                writeClient, readClient, properties.getStorage().getS3().getBucket());
    }

    static S3Client build(
            FileProperties.S3 properties,
            AwsCredentialsProvider credentialsProvider,
            boolean retryReads) {
        Objects.requireNonNull(properties);
        Objects.requireNonNull(credentialsProvider);
        S3ClientBuilder builder =
                S3Client.builder()
                        .region(Region.of(properties.getRegion()))
                        .credentialsProvider(credentialsProvider)
                        .serviceConfiguration(
                                software.amazon.awssdk.services.s3.S3Configuration.builder()
                                        .pathStyleAccessEnabled(properties.isPathStyleAccess())
                                        .build())
                        .httpClientBuilder(
                                ApacheHttpClient.builder()
                                        .connectionTimeout(
                                                positive(
                                                        properties.getConnectionTimeout(),
                                                        "connectionTimeout"))
                                        .socketTimeout(
                                                positive(
                                                        properties.getSocketTimeout(),
                                                        "socketTimeout")))
                        .overrideConfiguration(
                                configuration ->
                                        configuration
                                                .apiCallTimeout(
                                                        positive(
                                                                properties.getOperationTimeout(),
                                                                "operationTimeout"))
                                                .apiCallAttemptTimeout(
                                                        positive(
                                                                properties.getOperationTimeout(),
                                                                "operationTimeout"))
                                                .retryPolicy(
                                                        retryReads
                                                                ? RetryPolicy.builder()
                                                                        .numRetries(
                                                                                Math.max(
                                                                                        0,
                                                                                        properties
                                                                                                        .getReadMaxAttempts()
                                                                                                - 1))
                                                                        .build()
                                                                : RetryPolicy.none()));
        if (properties.getEndpoint() != null && !properties.getEndpoint().isBlank()) {
            builder.endpointOverride(URI.create(properties.getEndpoint()));
        }
        return builder.build();
    }

    static Duration positive(Duration value, String name) {
        if (value == null || value.isZero() || value.isNegative()) {
            throw new IllegalStateException("S3 " + name + " must be positive");
        }
        return value;
    }

    /** Test-only pair allowing isolated credentials and deterministic close handling. */
    static final class Clients implements AutoCloseable {
        private final S3Client write;
        private final S3Client read;

        private Clients(S3Client write, S3Client read) {
            this.write = write;
            this.read = read;
        }

        S3Client write() {
            return write;
        }

        S3Client read() {
            return read;
        }

        @Override
        public void close() {
            write.close();
            read.close();
        }
    }

    static Clients createClients(FileProperties.S3 properties) {
        AwsCredentialsProvider credentials = DefaultCredentialsProvider.create();
        return new Clients(
                build(properties, credentials, false), build(properties, credentials, true));
    }

    static Clients createClients(FileProperties.S3 properties, AwsCredentialsProvider credentials) {
        return new Clients(
                build(properties, credentials, false), build(properties, credentials, true));
    }
}
