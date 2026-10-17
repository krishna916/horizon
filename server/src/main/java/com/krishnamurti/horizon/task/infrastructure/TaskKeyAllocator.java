package com.krishnamurti.horizon.task.infrastructure;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/** Allocates immutable, monotonically increasing task numbers independently for each user. */
@Component
public class TaskKeyAllocator {

    private static final String ALLOCATE_NEXT_NUMBER_SQL =
            "INSERT INTO task_key_counter (user_id, last_allocated) VALUES (?, 1) "
                    + "ON CONFLICT (user_id) DO UPDATE SET "
                    + "last_allocated = task_key_counter.last_allocated + 1 "
                    + "RETURNING last_allocated";

    private final JdbcTemplate jdbcTemplate;

    public TaskKeyAllocator(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    /** Allocates the next task number within the caller's transaction. */
    public long allocateNextNumber(Long userId) {
        return jdbcTemplate.queryForObject(ALLOCATE_NEXT_NUMBER_SQL, Long.class, userId);
    }
}
