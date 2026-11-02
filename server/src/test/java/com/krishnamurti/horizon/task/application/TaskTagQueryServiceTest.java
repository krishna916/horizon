package com.krishnamurti.horizon.task.application;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.krishnamurti.horizon.tag.api.TagQueryApi;
import com.krishnamurti.horizon.tag.api.TagReference;
import com.krishnamurti.horizon.task.infrastructure.TaskTagAssociationRepository;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.Test;

class TaskTagQueryServiceTest {

    @Test
    void batchLoadsAndSortsTagsForAllTasksWithOneTagApiCall() {
        TaskTagAssociationRepository associations = mock(TaskTagAssociationRepository.class);
        TagQueryApi tagQueryApi = mock(TagQueryApi.class);
        TaskTagQueryService service = new TaskTagQueryService(associations, tagQueryApi);
        List<Long> taskIds = List.of(10L, 11L);
        when(associations.findTagIdsByTaskIds(7L, taskIds))
                .thenReturn(Map.of(10L, List.of(42L, 41L), 11L, List.of(43L)));
        when(tagQueryApi.findAllByIds(eq(7L), eq(Set.of(41L, 42L, 43L))))
                .thenReturn(
                        List.of(
                                new TagReference(42L, "alpha"),
                                new TagReference(43L, "zebra"),
                                new TagReference(41L, "ALPHA")));

        Map<Long, List<TagReference>> result = service.tagsForTasks(7L, taskIds);

        assertThat(result.get(10L))
                .extracting(TagReference::name)
                .containsExactly("ALPHA", "alpha");
        assertThat(result.get(11L)).extracting(TagReference::name).containsExactly("zebra");
        verify(associations).findTagIdsByTaskIds(7L, taskIds);
        verify(tagQueryApi).findAllByIds(eq(7L), eq(Set.of(41L, 42L, 43L)));
        verify(tagQueryApi, never())
                .findById(
                        org.mockito.ArgumentMatchers.anyLong(),
                        org.mockito.ArgumentMatchers.anyLong());
    }

    @Test
    void returnsEmptySetsWithoutCallingTagApiWhenNoTasksHaveTags() {
        TaskTagAssociationRepository associations = mock(TaskTagAssociationRepository.class);
        TagQueryApi tagQueryApi = mock(TagQueryApi.class);
        TaskTagQueryService service = new TaskTagQueryService(associations, tagQueryApi);
        List<Long> taskIds = List.of(10L, 11L);
        when(associations.findTagIdsByTaskIds(7L, taskIds)).thenReturn(Map.of());

        assertThat(service.tagsForTasks(7L, taskIds))
                .containsEntry(10L, List.of())
                .containsEntry(11L, List.of());
        verify(tagQueryApi, never())
                .findAllByIds(eq(7L), org.mockito.ArgumentMatchers.anyCollection());
    }
}
