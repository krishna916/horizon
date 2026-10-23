package com.krishnamurti.horizon.task.web;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;

class ChecklistOrderRequestTest {

    @Test
    void itemIdsAreCopiedAndCannotBeMutatedThroughAccessor() {
        List<Long> submittedIds = new ArrayList<>(List.of(4L, 2L, 9L));

        ChecklistOrderRequest request = new ChecklistOrderRequest(submittedIds);
        submittedIds.add(12L);

        assertThat(request.itemIds()).containsExactly(4L, 2L, 9L);
        assertThatThrownBy(() -> request.itemIds().add(12L))
                .isInstanceOf(UnsupportedOperationException.class);
    }
}
