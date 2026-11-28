package com.krishnamurti.horizon.file.infrastructure.persistence;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.krishnamurti.horizon.TestcontainersConfiguration;
import java.util.UUID;
import javax.sql.DataSource;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;

@SpringBootTest
@Import(TestcontainersConfiguration.class)
class FileRecoveryPersistenceIntegrationTest {
    @Autowired JdbcTemplate jdbc;
    @Autowired DataSource dataSource;
    private static final String DIGEST = "a".repeat(64);

    private UUID file() {
        Long user =
                jdbc.queryForObject(
                        "INSERT INTO"
                            + " users(email,password_hash,first_name,last_name,created_at,updated_at)"
                            + " VALUES (?,?,?, ?,now(),now()) RETURNING id",
                        Long.class,
                        UUID.randomUUID() + "@test.invalid",
                        "hash",
                        "Test",
                        "User");
        UUID id = UUID.randomUUID();
        jdbc.update(
                "INSERT INTO"
                    + " file_metadata(id,user_id,workspace,idempotency_key,binding_fingerprint,request_fingerprint,fingerprint_version,original_filename,declared_content_type,expected_size_bytes,expected_sha256,created_at,expires_at,updated_at)"
                    + " VALUES (?,?, 'notes',?,?,?,1,'x','text/plain',1,?,now(),now()+interval '1"
                    + " hour',now())",
                id,
                user,
                UUID.randomUUID(),
                DIGEST,
                DIGEST,
                DIGEST);
        return id;
    }

    private UUID attempt(UUID file) {
        UUID id = UUID.randomUUID();
        jdbc.update(
                "INSERT INTO"
                    + " file_transfer_attempt(id,file_id,object_key,expected_size_bytes,expected_sha256,outcome,created_at,updated_at)"
                    + " VALUES (?,?,?,1,?,'PENDING',now(),now())",
                id,
                file,
                id.toString(),
                DIGEST);
        return id;
    }

    @Test
    void rejectsHalfLeaseAndNegativeFailures() {
        UUID a = attempt(file());
        assertThatThrownBy(
                        () ->
                                jdbc.update(
                                        "UPDATE file_transfer_attempt SET cleanup_lease_token=?"
                                                + " WHERE id=?",
                                        UUID.randomUUID(),
                                        a))
                .isInstanceOf(DataIntegrityViolationException.class);
        assertThatThrownBy(
                        () ->
                                jdbc.update(
                                        "UPDATE file_transfer_attempt SET"
                                                + " consecutive_cleanup_failures=-1 WHERE id=?",
                                        a))
                .isInstanceOf(DataIntegrityViolationException.class);
    }

    @Test
    void rejectsTerminalConfirmationWithoutIntentOrSettlement() {
        UUID a = attempt(file());
        assertThatThrownBy(
                        () ->
                                jdbc.update(
                                        "UPDATE file_transfer_attempt SET"
                                            + " write_settled_at=now(),cleanup_confirmed_at=now()"
                                            + " WHERE id=?",
                                        a))
                .isInstanceOf(DataIntegrityViolationException.class);
        assertThatThrownBy(
                        () ->
                                jdbc.update(
                                        "UPDATE file_transfer_attempt SET"
                                            + " cleanup_requested_at=now(),cleanup_confirmed_at=now()"
                                            + " WHERE id=?",
                                        a))
                .isInstanceOf(DataIntegrityViolationException.class);
    }

    @Test
    void rejectsSchedulingCompactedAttempt() {
        UUID a = attempt(file());
        jdbc.update(
                "UPDATE file_transfer_attempt SET"
                    + " write_settled_at=now(),cleanup_requested_at=now(),cleanup_confirmed_at=now(),object_key=NULL,expected_size_bytes=NULL,expected_sha256=NULL"
                    + " WHERE id=?",
                a);
        assertThatThrownBy(
                        () ->
                                jdbc.update(
                                        "UPDATE file_transfer_attempt SET next_cleanup_at=now()"
                                                + " WHERE id=?",
                                        a))
                .isInstanceOf(DataIntegrityViolationException.class);
    }

    @Test
    void expiryFactRequiresUnclaimedAndAtOrAfterExpiry() {
        UUID f = file();
        assertThatThrownBy(
                        () ->
                                jdbc.update(
                                        "UPDATE file_metadata SET expiry_recorded_at=now() WHERE"
                                                + " id=?",
                                        f))
                .isInstanceOf(DataIntegrityViolationException.class);
        jdbc.update("UPDATE file_metadata SET expiry_recorded_at=expires_at WHERE id=?", f);
        assertThat(
                        jdbc.queryForObject(
                                "SELECT expiry_recorded_at IS NOT NULL FROM file_metadata WHERE"
                                        + " id=?",
                                Boolean.class,
                                f))
                .isTrue();
        UUID claimed = file();
        UUID selected = attempt(claimed);
        jdbc.update(
                "UPDATE file_metadata SET selected_attempt_id=?, validated_format='TXT',"
                        + " claimed_at=now() WHERE id=?",
                selected,
                claimed);
        assertThatThrownBy(
                        () ->
                                jdbc.update(
                                        "UPDATE file_metadata SET expiry_recorded_at=expires_at"
                                                + " WHERE id=?",
                                        claimed))
                .isInstanceOf(DataIntegrityViolationException.class);
    }

    @Test
    void retainsSelectedCompositeForeignKey() {
        UUID first = file(), second = file(), a = attempt(first);
        assertThatThrownBy(
                        () ->
                                jdbc.update(
                                        "UPDATE file_metadata SET selected_attempt_id=? WHERE id=?",
                                        a,
                                        second))
                .isInstanceOf(DataIntegrityViolationException.class);
    }

    @Test
    void migrationPreservesPreexistingUnknownAndCleanupIntent() {
        String schema = "upgrade_" + UUID.randomUUID().toString().replace("-", "");
        Flyway.configure()
                .dataSource(dataSource)
                .schemas(schema)
                .target("20261125000000")
                .load()
                .migrate();
        JdbcTemplate j = jdbc;
        Long user =
                j.queryForObject(
                        "INSERT INTO "
                                + schema
                                + ".users(email,password_hash,first_name,last_name,created_at,updated_at)"
                                + " VALUES (?,?,?, ?,now(),now()) RETURNING id",
                        Long.class,
                        UUID.randomUUID() + "@test.invalid",
                        "hash",
                        "Test",
                        "User");
        UUID f = UUID.randomUUID(), a = UUID.randomUUID();
        j.update(
                "INSERT INTO "
                        + schema
                        + ".file_metadata(id,user_id,workspace,idempotency_key,binding_fingerprint,request_fingerprint,fingerprint_version,original_filename,declared_content_type,expected_size_bytes,expected_sha256,created_at,expires_at,updated_at)"
                        + " VALUES (?,?, 'notes',?,?,?,1,'x','text/plain',1,?,now(),now()+interval"
                        + " '1 hour',now())",
                f,
                user,
                UUID.randomUUID(),
                DIGEST,
                DIGEST,
                DIGEST);
        j.update(
                "INSERT INTO "
                        + schema
                        + ".file_transfer_attempt(id,file_id,object_key,expected_size_bytes,expected_sha256,outcome,created_at,updated_at,cleanup_requested_at)"
                        + " VALUES (?,?,?,1,?,'UNKNOWN',now(),now(),now())",
                a,
                f,
                "preserved-key",
                DIGEST);
        Flyway.configure().dataSource(dataSource).schemas(schema).load().migrate();
        assertThat(
                        j.queryForMap(
                                "SELECT id,object_key,outcome,next_cleanup_at FROM "
                                        + schema
                                        + ".file_transfer_attempt WHERE id=?",
                                a))
                .containsEntry("object_key", "preserved-key")
                .containsEntry("outcome", "UNKNOWN")
                .containsEntry("next_cleanup_at", null);
    }
}
