package com.krishnamurti.horizon.file.infrastructure.persistence;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.krishnamurti.horizon.TestcontainersConfiguration;
import java.sql.Connection;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;
import javax.sql.DataSource;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfSystemProperty;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

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

    @Test
    @EnabledIfSystemProperty(named = "file.recovery.explain", matches = "true")
    void explainsProductionQueriesAgainstRepresentativeRecoveryBacklogs() throws Exception {
        jdbc.update("DELETE FROM file_transfer_attempt");
        jdbc.update("DELETE FROM file_metadata");
        Long user =
                jdbc.queryForObject(
                        "INSERT INTO"
                            + " users(email,password_hash,first_name,last_name,created_at,updated_at)"
                            + " VALUES (?,?,?, ?,now(),now()) RETURNING id",
                        Long.class,
                        UUID.randomUUID() + "@explain.test.invalid",
                        "hash",
                        "Explain",
                        "Fixture");
        insertExpiryRows(user, 2_000);
        insertTerminalRows(user, 64);
        insertUnknownRows(user, 128);
        setLeaseAndFutureBacklog();
        analyzeRecoveryTables();

        var smallBacklog = explainAllQueries(OffsetDateTime.now(ZoneOffset.UTC));
        printPlans(
                "small UNKNOWN backlog (128 UNKNOWN, 64 leased/future, 2,000 expiry,"
                        + " 64 terminal)",
                smallBacklog);

        insertUnknownRows(user, 5_000);
        analyzeRecoveryTables();
        var largeBacklog = explainAllQueries(OffsetDateTime.now(ZoneOffset.UTC));
        printPlans(
                "large UNKNOWN backlog (5,128 UNKNOWN before leases, 2,000 expiry,"
                        + " 64 terminal)",
                largeBacklog);

        List<String> lockedHeadPlan = explainWithLockedExpiryHead();
        printPlans("large backlog with oldest expiry parent locked", lockedHeadPlan);
        assertThat(lockedHeadPlan)
                .anyMatch(line -> line.contains("actual time") && line.contains("rows="));
    }

    private void insertExpiryRows(Long user, int count) {
        jdbc.update(
                "INSERT INTO"
                    + " file_metadata(id,user_id,workspace,idempotency_key,binding_fingerprint,"
                    + "request_fingerprint,fingerprint_version,original_filename,declared_content_type,expected_size_bytes,expected_sha256,created_at,expires_at,updated_at)"
                    + " SELECT"
                    + " gen_random_uuid(),?,'notes',gen_random_uuid(),?,?,1,'expire.txt','text/plain',1,?,now()-interval"
                    + " '2 days',now()-interval '1 day',now()-interval '2 days' FROM"
                    + " generate_series(1,?)",
                user,
                DIGEST,
                DIGEST,
                DIGEST,
                count);
    }

    private void insertUnknownRows(Long user, int count) {
        jdbc.update(
                "WITH parents AS (INSERT INTO file_metadata(id,user_id,workspace,idempotency_key,"
                    + "binding_fingerprint,request_fingerprint,fingerprint_version,original_filename,"
                    + "declared_content_type,expected_size_bytes,expected_sha256,created_at,expires_at,cleanup_requested_at,updated_at)"
                    + " SELECT"
                    + " gen_random_uuid(),?,'notes',gen_random_uuid(),?,?,1,'unknown.txt','text/plain',1,?,now()-interval"
                    + " '2 days',now()+interval '1 day',now()-interval '1 day',now()-interval '2"
                    + " days' FROM generate_series(1,?) RETURNING id) INSERT INTO"
                    + " file_transfer_attempt"
                    + "(id,file_id,object_key,expected_size_bytes,expected_sha256,outcome,created_at,updated_at,cleanup_requested_at)"
                    + " SELECT gen_random_uuid(),id,'explain/'||id,1,?,'UNKNOWN',now()-interval '2"
                    + " days',now()-interval '2 days',now()-interval '1 day' FROM parents",
                user,
                DIGEST,
                DIGEST,
                DIGEST,
                count,
                DIGEST);
    }

    private void insertTerminalRows(Long user, int count) {
        jdbc.update(
                "WITH parents AS (INSERT INTO file_metadata(id,user_id,workspace,idempotency_key,"
                    + "binding_fingerprint,request_fingerprint,fingerprint_version,original_filename,"
                    + "declared_content_type,expected_size_bytes,expected_sha256,created_at,expires_at,cleanup_requested_at,updated_at)"
                    + " SELECT"
                    + " gen_random_uuid(),?,'notes',gen_random_uuid(),?,?,1,'terminal.txt','text/plain',1,?,now()-interval"
                    + " '2 days',now()+interval '1 day',now()-interval '1 day',now()-interval '2"
                    + " days' FROM generate_series(1,?) RETURNING id) INSERT INTO"
                    + " file_transfer_attempt"
                    + "(id,file_id,outcome,created_at,updated_at,write_settled_at,cleanup_requested_at,cleanup_confirmed_at)"
                    + " SELECT gen_random_uuid(),id,'FAILED',now()-interval '2 days',now()-interval"
                    + " '1 day',now()-interval '1 day',now()-interval '1 day',now()-interval '1"
                    + " day' FROM parents",
                user,
                DIGEST,
                DIGEST,
                DIGEST,
                count);
    }

    private void setLeaseAndFutureBacklog() {
        jdbc.update(
                "UPDATE file_transfer_attempt SET"
                    + " cleanup_lease_token=gen_random_uuid(),cleanup_lease_until=now()+interval '1"
                    + " hour' WHERE id IN (SELECT id FROM file_transfer_attempt WHERE object_key"
                    + " LIKE 'explain/%' ORDER BY id LIMIT 32)");
        jdbc.update(
                "UPDATE file_transfer_attempt SET next_cleanup_at=now()+interval '1 hour'"
                        + " WHERE id IN (SELECT id FROM file_transfer_attempt WHERE object_key LIKE"
                        + " 'explain/%' AND cleanup_lease_token IS NULL ORDER BY id LIMIT 32)");
    }

    private void analyzeRecoveryTables() {
        jdbc.execute("ANALYZE file_metadata");
        jdbc.execute("ANALYZE file_transfer_attempt");
    }

    private List<String> explainAllQueries(OffsetDateTime now) {
        var plans = new java.util.ArrayList<String>();
        var transaction = new TransactionTemplate(new DataSourceTransactionManager(dataSource));
        for (var kind : FileRecoveryPersistence.WorkKind.values()) {
            Object[] args =
                    kind == FileRecoveryPersistence.WorkKind.DELETE_ATTEMPT
                            ? new Object[] {now, now, now, now, now, now, 25}
                            : new Object[] {now, 25};
            List<String> plan =
                    transaction.execute(
                            status -> {
                                List<String> rows =
                                        jdbc.query(
                                                "EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) "
                                                        + FileRecoveryPersistence.candidateSql(
                                                                kind),
                                                (rs, row) -> rs.getString(1),
                                                args);
                                status.setRollbackOnly();
                                return rows;
                            });
            plans.add("-- " + kind + " --\n" + String.join("\n", plan));
        }
        var aggregate =
                transaction.execute(
                        status -> {
                            var named = new NamedParameterJdbcTemplate(jdbc);
                            List<String> rows =
                                    named.query(
                                            "EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) "
                                                    + FileRecoveryPersistence.recoveryCountsSql(),
                                            new MapSqlParameterSource("now", now),
                                            (rs, row) -> rs.getString(1));
                            status.setRollbackOnly();
                            return rows;
                        });
        plans.add("-- recoveryCounts --\n" + String.join("\n", aggregate));
        return plans;
    }

    private List<String> explainWithLockedExpiryHead() throws Exception {
        UUID head =
                jdbc.queryForObject(
                        "SELECT id FROM file_metadata WHERE claimed_at IS NULL"
                                + " AND cleanup_requested_at IS NULL AND expiry_recorded_at IS NULL"
                                + " AND purged_at IS NULL ORDER BY expires_at,id LIMIT 1",
                        UUID.class);
        try (Connection held = dataSource.getConnection()) {
            held.setAutoCommit(false);
            try (var lock =
                    held.prepareStatement("SELECT id FROM file_metadata WHERE id=? FOR UPDATE")) {
                lock.setObject(1, head);
                lock.executeQuery().close();
            }
            try {
                return new TransactionTemplate(new DataSourceTransactionManager(dataSource))
                        .execute(
                                status -> {
                                    List<String> plan =
                                            jdbc.query(
                                                    "EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) "
                                                            + FileRecoveryPersistence.candidateSql(
                                                                    FileRecoveryPersistence.WorkKind
                                                                            .EXPIRE_FILE),
                                                    (rs, row) -> rs.getString(1),
                                                    OffsetDateTime.now(ZoneOffset.UTC),
                                                    25);
                                    status.setRollbackOnly();
                                    return plan;
                                });
            } finally {
                held.rollback();
            }
        }
    }

    private void printPlans(String population, List<String> plans) {
        System.out.println("PostgreSQL recovery EXPLAIN ANALYZE: " + population);
        plans.forEach(System.out::println);
    }
}
