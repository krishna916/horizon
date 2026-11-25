package com.krishnamurti.horizon;

import com.krishnamurti.horizon.file.application.RecordingObjectStorage;
import com.krishnamurti.horizon.file.application.port.ObjectStorage;
import java.nio.file.Path;
import java.util.Map;
import java.util.UUID;
import org.springframework.beans.factory.config.BeanFactoryPostProcessor;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;
import org.springframework.core.env.ConfigurableEnvironment;
import org.springframework.core.env.MapPropertySource;

/** Provides private, per-context File infrastructure to application integration tests. */
@TestConfiguration(proxyBeanMethods = false)
public class FileTestInfrastructureConfiguration {

    @Bean
    static BeanFactoryPostProcessor uniqueFileStagingDirectoryForTestContext(
            ConfigurableEnvironment environment) {
        return beanFactory ->
                environment
                        .getPropertySources()
                        .addFirst(
                                new MapPropertySource(
                                        "test-file-staging-" + UUID.randomUUID(),
                                        Map.of(
                                                "horizon.file.staging.directory",
                                                Path.of(
                                                                System.getProperty(
                                                                        "java.io.tmpdir"),
                                                                "horizon-file-staging-test-"
                                                                        + UUID.randomUUID())
                                                        .toString())));
    }

    @Bean
    @Primary
    ObjectStorage testObjectStorage() {
        return new RecordingObjectStorage();
    }
}
