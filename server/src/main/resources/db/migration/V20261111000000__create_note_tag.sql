CREATE TABLE note_tag (
    note_id BIGINT NOT NULL,
    tag_id BIGINT NOT NULL,
    CONSTRAINT pk_note_tag PRIMARY KEY (note_id, tag_id),
    CONSTRAINT fk_note_tag_note FOREIGN KEY (note_id) REFERENCES note (id),
    CONSTRAINT fk_note_tag_tag FOREIGN KEY (tag_id) REFERENCES tag (id)
);

CREATE INDEX idx_note_tag_tag_id ON note_tag (tag_id);
