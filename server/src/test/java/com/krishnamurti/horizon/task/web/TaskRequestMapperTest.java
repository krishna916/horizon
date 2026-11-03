package com.krishnamurti.horizon.task.web;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.krishnamurti.horizon.task.application.TaskTagSelection;
import java.util.Map;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

class TaskRequestMapperTest {

    private final TaskRequestMapper mapper = new TaskRequestMapper();
    private final JsonMapper jsonMapper = JsonMapper.builder().build();

    @Test
    void postMissingTagsDefaultsToEmptyAndPatchMissingTagsRemainsAbsent() {
        assertThat(mapper.parseTags(null)).isEmpty();
        assertThat(mapper.toPatch(titleOnlyRequest()).tags().present()).isFalse();
    }

    @Test
    void parsesAnEmptySetAndMixedExistingAndNewSelections() {
        assertThat(mapper.toPatch(requestWithTags("[]")).tags().value()).isEmpty();
        assertThat(mapper.parseTags(json("[{\"id\":42},{\"name\":\"Architecture\"}]")))
                .containsExactly(
                        new TaskTagSelection(42L, null),
                        new TaskTagSelection(null, "Architecture"));
    }

    @Test
    void rejectsMalformedTagReferencesWithTagFieldErrors() {
        for (String tags :
                new String[] {
                    "null",
                    "{}",
                    "[1]",
                    "[{\"id\":0}]",
                    "[{\"id\":-1}]",
                    "[{\"id\":1.5}]",
                    "[{\"id\":42,\"name\":\"Architecture\"}]",
                    "[{}]",
                    "[{\"id\":42,\"extra\":true}]",
                    "[{\"name\":42}]",
                    "[{\"name\":\"   \"}]"
                }) {
            assertThatThrownBy(() -> mapper.parseTags(json(tags)))
                    .isInstanceOfSatisfying(
                            TaskRequestValidationException.class,
                            exception -> assertThat(exception.getField()).isEqualTo("tags"));
        }
    }

    private UpdateTaskRequest titleOnlyRequest() {
        return new UpdateTaskRequest(Map.of("title", json("\"Task\"")));
    }

    private UpdateTaskRequest requestWithTags(String content) {
        return new UpdateTaskRequest(Map.of("title", json("\"Task\""), "tags", json(content)));
    }

    private JsonNode json(String value) {
        return jsonMapper.readTree(value);
    }
}
