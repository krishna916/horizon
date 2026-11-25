package com.krishnamurti.horizon.file.infrastructure.persistence;

import com.krishnamurti.horizon.file.domain.FileMetadataEntity;
import jakarta.persistence.LockModeType;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface FileMetadataRepository extends JpaRepository<FileMetadataEntity, UUID> {
    Optional<FileMetadataEntity> findByIdempotencyKey(UUID idempotencyKey);

    Optional<FileMetadataEntity> findByIdAndUserIdAndWorkspaceAndBindingFingerprint(
            UUID id, Long userId, String workspace, String bindingFingerprint);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select file from FileMetadataEntity file where file.id = :id")
    Optional<FileMetadataEntity> lockById(@Param("id") UUID id);
}
