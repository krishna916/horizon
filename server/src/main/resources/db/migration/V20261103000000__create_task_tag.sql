CREATE TABLE task_tag (
    task_id BIGINT NOT NULL,
    tag_id BIGINT NOT NULL,
    CONSTRAINT pk_task_tag PRIMARY KEY (task_id, tag_id),
    CONSTRAINT fk_task_tag_task FOREIGN KEY (task_id) REFERENCES task (id),
    CONSTRAINT fk_task_tag_tag FOREIGN KEY (tag_id) REFERENCES tag (id)
);

CREATE INDEX idx_task_tag_tag_id ON task_tag (tag_id);
