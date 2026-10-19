package com.krishnamurti.horizon.task.infrastructure;

import static org.assertj.core.api.Assertions.assertThat;

import com.krishnamurti.horizon.TestcontainersConfiguration;
import com.krishnamurti.horizon.task.domain.Task;
import com.krishnamurti.horizon.user.application.UserCommandService;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

@SpringBootTest(properties = "spring.jpa.hibernate.ddl-auto=validate")
@Import(TestcontainersConfiguration.class)
class TaskCreationRequestRepositoryTest {

    @Autowired private TaskCreationRequestRepository creationRequestRepository;
    @Autowired private UserCommandService userCommandService;
    @Autowired private TaskRepository taskRepository;
    @Autowired private PlatformTransactionManager transactionManager;

    @Test
    void claimsOnceAndCompletesReceiptForOwner() {
        Long userId = createUserId();
        UUID requestKey = UUID.randomUUID();
        String fingerprint = "a".repeat(64);
        Task task =
                taskRepository.saveAndFlush(
                        Task.create(userId, "TASK-1", "Created", null, null, null));

        new TransactionTemplate(transactionManager)
                .executeWithoutResult(
                        status -> {
                            assertThat(
                                            creationRequestRepository.claim(
                                                    userId, requestKey, fingerprint))
                                    .isTrue();
                            assertThat(
                                            creationRequestRepository.claim(
                                                    userId, requestKey, fingerprint))
                                    .isFalse();
                            creationRequestRepository.complete(userId, requestKey, task.getId());
                        });

        assertThat(creationRequestRepository.find(userId, requestKey))
                .contains(new TaskCreationReceipt(fingerprint, task.getId()));
    }

    @Test
    void sameRequestKeyCanBeClaimedByDifferentUsers() {
        Long firstUserId = createUserId();
        Long secondUserId = createUserId();
        UUID requestKey = UUID.randomUUID();

        new TransactionTemplate(transactionManager)
                .executeWithoutResult(
                        status -> {
                            assertThat(
                                            creationRequestRepository.claim(
                                                    firstUserId, requestKey, "a".repeat(64)))
                                    .isTrue();
                            assertThat(
                                            creationRequestRepository.claim(
                                                    secondUserId, requestKey, "b".repeat(64)))
                                    .isTrue();
                            status.setRollbackOnly();
                        });
    }

    @Test
    void transactionRollbackRemovesTheUncommittedClaim() {
        Long userId = createUserId();
        UUID requestKey = UUID.randomUUID();
        String fingerprint = "c".repeat(64);

        new TransactionTemplate(transactionManager)
                .executeWithoutResult(
                        status -> {
                            assertThat(
                                            creationRequestRepository.claim(
                                                    userId, requestKey, fingerprint))
                                    .isTrue();
                            status.setRollbackOnly();
                        });

        assertThat(creationRequestRepository.find(userId, requestKey)).isEmpty();
        Boolean claimedAgain =
                new TransactionTemplate(transactionManager)
                        .execute(
                                status ->
                                        creationRequestRepository.claim(
                                                userId, requestKey, fingerprint));

        assertThat(claimedAgain).isTrue();
    }

    private Long createUserId() {
        return userCommandService.register(UUID.randomUUID() + "@example.com", "Password123!").id();
    }
}
