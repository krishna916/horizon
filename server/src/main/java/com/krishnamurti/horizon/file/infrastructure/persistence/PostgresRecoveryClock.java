package com.krishnamurti.horizon.file.infrastructure.persistence;

import com.krishnamurti.horizon.file.application.RecoveryClock;
import edu.umd.cs.findbugs.annotations.SuppressFBWarnings;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.Objects;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

@Component
public class PostgresRecoveryClock implements RecoveryClock {
    private final JdbcTemplate jdbc;

    @SuppressFBWarnings(
            value = "EI_EXPOSE_REP2",
            justification =
                    "The injected JdbcTemplate is a private final Spring-managed dependency.")
    public PostgresRecoveryClock(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    public Instant now() {
        return Objects.requireNonNull(
                        jdbc.queryForObject("SELECT clock_timestamp()", OffsetDateTime.class),
                        "PostgreSQL clock query returned null")
                .toInstant();
    }
}
