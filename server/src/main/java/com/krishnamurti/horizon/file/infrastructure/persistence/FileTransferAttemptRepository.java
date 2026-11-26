package com.krishnamurti.horizon.file.infrastructure.persistence;

import com.krishnamurti.horizon.file.domain.FileTransferAttemptEntity;
import jakarta.persistence.LockModeType;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface FileTransferAttemptRepository
        extends JpaRepository<FileTransferAttemptEntity, UUID> {
    List<FileTransferAttemptEntity> findAllByFileIdOrderByCreatedAtAsc(UUID fileId);

    Optional<FileTransferAttemptEntity> findByFileIdAndId(UUID fileId, UUID id);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query(
            "select attempt from FileTransferAttemptEntity attempt where attempt.fileId = :fileId"
                    + " and attempt.id = :id")
    Optional<FileTransferAttemptEntity> lockByFileIdAndId(
            @Param("fileId") UUID fileId, @Param("id") UUID id);
}
