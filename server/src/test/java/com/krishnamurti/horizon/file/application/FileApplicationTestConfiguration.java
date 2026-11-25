package com.krishnamurti.horizon.file.application;

import com.krishnamurti.horizon.file.api.FileService;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

@TestConfiguration(proxyBeanMethods = false)
public class FileApplicationTestConfiguration {

    @Bean
    TestFileOwner testFileOwner(
            PlatformTransactionManager transactionManager, FileService fileService) {
        return new TestFileOwner(new TransactionTemplate(transactionManager), fileService);
    }
}
