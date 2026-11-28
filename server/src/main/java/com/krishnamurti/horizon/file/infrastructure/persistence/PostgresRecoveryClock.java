package com.krishnamurti.horizon.file.infrastructure.persistence;

import com.krishnamurti.horizon.file.application.RecoveryClock;
import java.time.Instant;
import java.time.OffsetDateTime;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

@Component
public class PostgresRecoveryClock implements RecoveryClock {
    private final JdbcTemplate jdbc;

    public PostgresRecoveryClock(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    public Instant now() {
        return jdbc.queryForObject("SELECT clock_timestamp()", OffsetDateTime.class).toInstant();
    }
}
