package com.krishnamurti.horizon.file.infrastructure;

import com.krishnamurti.horizon.file.application.FileRecoveryWorker;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableScheduling;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.scheduling.concurrent.ThreadPoolTaskScheduler;

@Configuration(proxyBeanMethods = false)
@EnableScheduling
@ConditionalOnProperty(
        prefix = "horizon.file.recovery",
        name = "enabled",
        havingValue = "true",
        matchIfMissing = true)
public class FileRecoverySchedulingConfiguration {
    @Bean(name = "fileRecoveryScheduler")
    ThreadPoolTaskScheduler fileRecoveryScheduler() {
        var scheduler = new ThreadPoolTaskScheduler();
        scheduler.setPoolSize(1);
        scheduler.setThreadNamePrefix("file-recovery-");
        scheduler.setWaitForTasksToCompleteOnShutdown(true);
        return scheduler;
    }

    @Bean
    ScheduledRecovery scheduledRecovery(FileRecoveryWorker worker) {
        return new ScheduledRecovery(worker);
    }

    static class ScheduledRecovery {
        private final FileRecoveryWorker worker;

        ScheduledRecovery(FileRecoveryWorker worker) {
            this.worker = worker;
        }

        @Scheduled(
                scheduler = "fileRecoveryScheduler",
                fixedDelayString = "${horizon.file.recovery.poll-interval:30s}")
        public void poll() {
            worker.runCycle();
        }
    }
}
