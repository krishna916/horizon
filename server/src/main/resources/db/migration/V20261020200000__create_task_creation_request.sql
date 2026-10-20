CREATE TABLE task_creation_request (
    user_id BIGINT NOT NULL,
    request_key UUID NOT NULL,
    request_fingerprint VARCHAR(64) NOT NULL,
    task_id BIGINT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pk_task_creation_request PRIMARY KEY (user_id, request_key),
    CONSTRAINT fk_task_creation_request_users FOREIGN KEY (user_id) REFERENCES users (id),
    CONSTRAINT fk_task_creation_request_task FOREIGN KEY (task_id) REFERENCES task (id)
);
