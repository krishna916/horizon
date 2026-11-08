package com.krishnamurti.horizon.note.application;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.krishnamurti.horizon.TestcontainersConfiguration;
import com.krishnamurti.horizon.note.domain.Note;
import com.krishnamurti.horizon.note.infrastructure.NoteRepository;
import com.krishnamurti.horizon.user.application.UserCommandService;
import jakarta.persistence.EntityManager;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;

@SpringBootTest
@Import(TestcontainersConfiguration.class)
class NoteQueryServiceIntegrationTest {

    @Autowired private NoteQueryService queryService;
    @Autowired private NoteRepository noteRepository;
    @Autowired private UserCommandService userCommandService;
    @Autowired private JdbcTemplate jdbcTemplate;
    @Autowired private EntityManager entityManager;

    @AfterEach
    void clearSecurityContext() {
        SecurityContextHolder.clearContext();
    }

    @Test
    void pagesAreOwnerScopedLifecycleFilteredAndCountsIgnoreTheSelectedPage() {
        Long owner = createUserId();
        Long foreignOwner = createUserId();
        Note first = save(owner, "First");
        Note second = save(owner, "Second");
        Note inbox = save(owner, "Inbox");
        Note archived = save(owner, "Archived");
        Note deleted = save(owner, "Deleted");
        Note foreign = save(foreignOwner, "Foreign");
        OffsetDateTime tie = OffsetDateTime.of(2026, 11, 1, 12, 0, 0, 0, ZoneOffset.UTC);
        jdbcTemplate.update(
                "UPDATE note SET updated_at = ? WHERE user_id = ? AND deleted_at IS NULL",
                tie,
                owner);
        jdbcTemplate.update("UPDATE note SET inbox = TRUE WHERE id = ?", inbox.getId());
        jdbcTemplate.update("UPDATE note SET archived_at = ? WHERE id = ?", tie, archived.getId());
        jdbcTemplate.update("UPDATE note SET deleted_at = ? WHERE id = ?", tie, deleted.getId());
        entityManager.clear();
        setCurrentUser(owner);

        NotePage firstPage = queryService.list(NoteCollection.ACTIVE, NoteSort.UPDATED_DESC, 0, 2);
        NotePage secondPage = queryService.list(NoteCollection.ACTIVE, NoteSort.UPDATED_DESC, 1, 2);
        NotePage outside = queryService.list(NoteCollection.ACTIVE, NoteSort.UPDATED_DESC, 9, 2);
        NotePage archivedPage =
                queryService.list(NoteCollection.ARCHIVED, NoteSort.UPDATED_DESC, 0, 30);

        assertThat(firstPage.items())
                .extracting(Note::getId)
                .containsExactly(inbox.getId(), second.getId());
        assertThat(secondPage.items()).extracting(Note::getId).containsExactly(first.getId());
        assertThat(firstPage.hasNext()).isTrue();
        assertThat(secondPage.hasNext()).isFalse();
        assertThat(outside.items()).isEmpty();
        assertThat(outside.counts()).isEqualTo(new NoteCounts(3, 1));
        assertThat(archivedPage.items()).extracting(Note::getId).containsExactly(archived.getId());
        assertThat(firstPage.counts()).isEqualTo(new NoteCounts(3, 1));
        assertThat(firstPage.items())
                .extracting(Note::getId)
                .doesNotContain(foreign.getId(), deleted.getId());
    }

    @Test
    void titleSortIsCaseInsensitiveNullLastAndStable() {
        Long owner = createUserId();
        Note upper = save(owner, "Alpha");
        Note lower = save(owner, "alpha");
        Note zulu = save(owner, "Zulu");
        Note untitled = save(owner, null);
        setCurrentUser(owner);

        NotePage page = queryService.list(NoteCollection.ACTIVE, NoteSort.TITLE_ASC, 0, 10);

        assertThat(page.items())
                .extracting(Note::getId)
                .containsExactly(upper.getId(), lower.getId(), zulu.getId(), untitled.getId());
    }

    @Test
    void updatedSortDirectionsUseIdAsTieBreaker() {
        Long owner = createUserId();
        Note first = save(owner, "First");
        Note second = save(owner, "Second");
        Note third = save(owner, "Third");
        jdbcTemplate.update(
                "UPDATE note SET updated_at = ? WHERE id IN (?, ?, ?)",
                OffsetDateTime.of(2026, 11, 1, 12, 0, 0, 0, ZoneOffset.UTC),
                first.getId(),
                second.getId(),
                third.getId());
        entityManager.clear();
        setCurrentUser(owner);

        assertThat(queryService.list(NoteCollection.ACTIVE, NoteSort.UPDATED_ASC, 0, 10).items())
                .extracting(Note::getId)
                .containsExactly(first.getId(), second.getId(), third.getId());
        assertThat(queryService.list(NoteCollection.ACTIVE, NoteSort.UPDATED_DESC, 0, 10).items())
                .extracting(Note::getId)
                .containsExactly(third.getId(), second.getId(), first.getId());
    }

    @Test
    void rejectsInvalidPageAndPageSize() {
        Long owner = createUserId();
        setCurrentUser(owner);

        assertThatThrownBy(
                        () ->
                                queryService.list(
                                        NoteCollection.ACTIVE, NoteSort.UPDATED_DESC, -1, 30))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(
                        () ->
                                queryService.list(
                                        NoteCollection.ACTIVE, NoteSort.UPDATED_DESC, 0, 101))
                .isInstanceOf(IllegalArgumentException.class);
    }

    private Note save(Long owner, String title) {
        return noteRepository.saveAndFlush(
                Note.create(owner, title, title == null ? body("untitled content") : null));
    }

    private void setCurrentUser(Long userId) {
        SecurityContextHolder.getContext()
                .setAuthentication(new UsernamePasswordAuthenticationToken(userId, "", List.of()));
    }

    private Long createUserId() {
        String suffix = UUID.randomUUID().toString();
        return userCommandService
                .register("note-query-" + suffix + "@example.com", "StrongPassword123!")
                .id();
    }

    private static java.util.Map<String, Object> body(String text) {
        return java.util.Map.of(
                "type",
                "doc",
                "content",
                List.of(
                        java.util.Map.of(
                                "type",
                                "paragraph",
                                "content",
                                List.of(java.util.Map.of("type", "text", "text", text)))));
    }
}
