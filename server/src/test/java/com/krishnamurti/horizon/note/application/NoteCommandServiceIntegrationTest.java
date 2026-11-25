package com.krishnamurti.horizon.note.application;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.krishnamurti.horizon.TestcontainersConfiguration;
import com.krishnamurti.horizon.note.domain.Note;
import com.krishnamurti.horizon.note.infrastructure.NoteRepository;
import com.krishnamurti.horizon.user.application.UserCommandService;
import jakarta.persistence.EntityManager;
import java.time.OffsetDateTime;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
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
class NoteCommandServiceIntegrationTest {

    @Autowired private NoteCommandService commandService;
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
    void omittedFieldsAndVersionOnlyNoOpPreserveValuesAndMetadata() {
        Long owner = createUserId();
        Note saved = noteRepository.saveAndFlush(Note.create(owner, "Title", body("Body")));
        entityManager.clear();
        Note note =
                noteRepository
                        .findByIdAndUserIdAndDeletedAtIsNull(saved.getId(), owner)
                        .orElseThrow();
        OffsetDateTime updatedAt = note.getUpdatedAt();
        setCurrentUser(owner);

        Note result =
                commandService.update(
                        note.getId(), new NotePatch(0, FieldUpdate.absent(), FieldUpdate.absent()));

        assertThat(result.getTitle()).isEqualTo("Title");
        assertThat(result.getContent()).isEqualTo(body("Body"));
        assertThat(result.getVersion()).isZero();
        assertThat(result.getUpdatedAt()).isEqualTo(updatedAt);
    }

    @Test
    void suppliedChangesAdvanceVersionAndCanClearBothFields() {
        Long owner = createUserId();
        Note note = noteRepository.saveAndFlush(Note.create(owner, "Title", body("Body")));
        jdbcTemplate.update(
                "UPDATE note SET updated_at = CURRENT_TIMESTAMP - INTERVAL '10 seconds' WHERE id ="
                        + " ?",
                note.getId());
        entityManager.clear();
        setCurrentUser(owner);

        Note changed =
                commandService.update(
                        note.getId(),
                        new NotePatch(0, FieldUpdate.of("Next"), FieldUpdate.absent()));
        assertThat(changed.getVersion()).isEqualTo(1L);
        assertThat(changed.getUpdatedAt()).isAfter(note.getUpdatedAt());

        Note cleared =
                commandService.update(
                        note.getId(), new NotePatch(1, FieldUpdate.of("  "), FieldUpdate.of(null)));
        assertThat(cleared.getTitle()).isNull();
        assertThat(cleared.getContent()).isNull();
        assertThat(cleared.getVersion()).isEqualTo(2L);
    }

    @Test
    void staleVersionConflictsEvenForNoOpAndArchivedNotesRemainEditable() {
        Long owner = createUserId();
        Note note = noteRepository.saveAndFlush(Note.create(owner, "Title", body("Body")));
        jdbcTemplate.update(
                "UPDATE note SET archived_at = CURRENT_TIMESTAMP WHERE id = ?", note.getId());
        entityManager.clear();
        setCurrentUser(owner);

        assertThatThrownBy(
                        () ->
                                commandService.update(
                                        note.getId(),
                                        new NotePatch(
                                                1, FieldUpdate.absent(), FieldUpdate.absent())))
                .isInstanceOf(NoteVersionConflictException.class);
        assertThat(
                        commandService
                                .update(
                                        note.getId(),
                                        new NotePatch(
                                                0,
                                                FieldUpdate.of("Archived edit"),
                                                FieldUpdate.absent()))
                                .getTitle())
                .isEqualTo("Archived edit");
    }

    @Test
    void missingForeignAndDeletedNotesAreIndistinguishableNotFound() {
        Long firstOwner = createUserId();
        Long secondOwner = createUserId();
        Note foreign = noteRepository.saveAndFlush(Note.create(firstOwner, "Foreign", null));
        Note deleted = noteRepository.saveAndFlush(Note.create(secondOwner, "Deleted", null));
        jdbcTemplate.update(
                "UPDATE note SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?", deleted.getId());
        setCurrentUser(secondOwner);

        assertThatThrownBy(() -> commandService.update(-1L, noOp(0)))
                .isInstanceOf(NoteNotFoundException.class);
        assertThatThrownBy(() -> commandService.update(foreign.getId(), noOp(0)))
                .isInstanceOf(NoteNotFoundException.class);
        assertThatThrownBy(() -> commandService.update(deleted.getId(), noOp(0)))
                .isInstanceOf(NoteNotFoundException.class);
    }

    @Test
    void concurrentUpdatesAgainstSameVersionHaveOneWinner() throws Exception {
        Long owner = createUserId();
        Note note = noteRepository.saveAndFlush(Note.create(owner, "Title", body("Body")));
        int attempts = 2;
        CountDownLatch ready = new CountDownLatch(attempts);
        CountDownLatch start = new CountDownLatch(1);
        ExecutorService executor = Executors.newFixedThreadPool(attempts);
        try {
            List<Callable<Boolean>> updates =
                    List.of("first", "second").stream()
                            .<Callable<Boolean>>map(
                                    title ->
                                            () -> {
                                                setCurrentUser(owner);
                                                ready.countDown();
                                                if (!start.await(10, TimeUnit.SECONDS))
                                                    return false;
                                                try {
                                                    commandService.update(
                                                            note.getId(),
                                                            new NotePatch(
                                                                    0,
                                                                    FieldUpdate.of(title),
                                                                    FieldUpdate.absent()));
                                                    return true;
                                                } catch (NoteVersionConflictException exception) {
                                                    return false;
                                                } finally {
                                                    SecurityContextHolder.clearContext();
                                                }
                                            })
                            .toList();
            List<Future<Boolean>> results = updates.stream().map(executor::submit).toList();
            assertThat(ready.await(10, TimeUnit.SECONDS)).isTrue();
            start.countDown();
            assertThat(results.stream().filter(this::getResult).count()).isEqualTo(1);
            entityManager.clear();
            Note stored =
                    noteRepository
                            .findByIdAndUserIdAndDeletedAtIsNull(note.getId(), owner)
                            .orElseThrow();
            assertThat(stored.getVersion()).isEqualTo(1L);
        } finally {
            start.countDown();
            executor.shutdownNow();
            assertThat(executor.awaitTermination(10, TimeUnit.SECONDS)).isTrue();
        }
    }

    @Test
    void concurrentTagOnlyPatchesAgainstSameVersionHaveOneWinner() throws Exception {
        Long owner = createUserId();
        Note note = noteRepository.saveAndFlush(Note.create(owner, "Title", body("Body")));
        int attempts = 2;
        CountDownLatch ready = new CountDownLatch(attempts);
        CountDownLatch start = new CountDownLatch(1);
        ExecutorService executor = Executors.newFixedThreadPool(attempts);
        try {
            List<Callable<Boolean>> updates =
                    List.of("First", "Second").stream()
                            .<Callable<Boolean>>map(
                                    name ->
                                            () -> {
                                                setCurrentUser(owner);
                                                ready.countDown();
                                                if (!start.await(10, TimeUnit.SECONDS))
                                                    return false;
                                                try {
                                                    commandService.update(
                                                            note.getId(),
                                                            new NotePatch(
                                                                    0,
                                                                    FieldUpdate.absent(),
                                                                    FieldUpdate.absent(),
                                                                    FieldUpdate.of(
                                                                            List.of(
                                                                                    new NoteTagSelection(
                                                                                            null,
                                                                                            name)))));
                                                    return true;
                                                } catch (NoteVersionConflictException exception) {
                                                    return false;
                                                } finally {
                                                    SecurityContextHolder.clearContext();
                                                }
                                            })
                            .toList();
            List<Future<Boolean>> results = updates.stream().map(executor::submit).toList();
            assertThat(ready.await(10, TimeUnit.SECONDS)).isTrue();
            start.countDown();
            assertThat(results.stream().filter(this::getResult).count()).isEqualTo(1);
            entityManager.clear();
            Note stored =
                    noteRepository
                            .findByIdAndUserIdAndDeletedAtIsNull(note.getId(), owner)
                            .orElseThrow();
            assertThat(stored.getVersion()).isEqualTo(1L);
            assertThat(
                            jdbcTemplate.queryForObject(
                                    "SELECT COUNT(*) FROM note_tag WHERE note_id = ?",
                                    Integer.class,
                                    note.getId()))
                    .isEqualTo(1);
            assertThat(
                            jdbcTemplate.queryForObject(
                                    "SELECT COUNT(*) FROM tag WHERE user_id = ?",
                                    Integer.class,
                                    owner))
                    .isEqualTo(1);
        } finally {
            start.countDown();
            executor.shutdownNow();
            assertThat(executor.awaitTermination(10, TimeUnit.SECONDS)).isTrue();
        }
    }

    @Test
    void lifecycleAdvancesVersionExactlyOnceAndMatchingVersionNoOpDoesNotAdvanceVersion() {
        Long owner = createUserId();
        Note note = noteRepository.saveAndFlush(Note.create(owner, "Title", body("Body")));
        setCurrentUser(owner);

        Note archived = commandService.archive(note.getId(), 0L);
        assertThat(archived.getVersion()).isEqualTo(1L);
        assertThat(archived.getArchivedAt()).isNotNull();
        entityManager.clear();
        OffsetDateTime updatedAt =
                noteRepository
                        .findByIdAndUserIdAndDeletedAtIsNull(note.getId(), owner)
                        .orElseThrow()
                        .getUpdatedAt();

        Note repeated = commandService.archive(note.getId(), 1L);
        assertThat(repeated.getVersion()).isEqualTo(1L);
        assertThat(repeated.getUpdatedAt().truncatedTo(ChronoUnit.MICROS))
                .isEqualTo(updatedAt.truncatedTo(ChronoUnit.MICROS));
    }

    @Test
    void staleVersionConflictsForLifecycleCommands() {
        Long owner = createUserId();
        Note note = noteRepository.saveAndFlush(Note.create(owner, "Title", body("Body")));
        setCurrentUser(owner);

        assertThatThrownBy(() -> commandService.archive(note.getId(), 1L))
                .isInstanceOf(NoteVersionConflictException.class);
    }

    @Test
    void olderNonnegativeDeleteVersionConflictsButExactRetryDoesNotAdvanceVersion() {
        Long owner = createUserId();
        Note note = noteRepository.saveAndFlush(Note.create(owner, "Title", body("Body")));
        setCurrentUser(owner);

        Note archived = commandService.archive(note.getId(), 0L);
        assertThat(archived.getVersion()).isEqualTo(1L);
        OffsetDateTime archivedAt =
                noteRepository.findByIdAndUserId(note.getId(), owner).orElseThrow().getArchivedAt();

        Note deleted = commandService.softDelete(note.getId(), 1L);
        assertThat(deleted.getVersion()).isEqualTo(2L);
        assertThat(commandService.softDelete(note.getId(), 1L).getVersion()).isEqualTo(2L);
        assertThatThrownBy(() -> commandService.softDelete(note.getId(), 0L))
                .isInstanceOf(NoteVersionConflictException.class);

        Note persisted = noteRepository.findByIdAndUserId(note.getId(), owner).orElseThrow();
        assertThat(persisted.getVersion()).isEqualTo(2L);
        assertThat(persisted.getArchivedAt().truncatedTo(ChronoUnit.MICROS))
                .isEqualTo(archivedAt.truncatedTo(ChronoUnit.MICROS));
        assertThat(persisted.getDeletedAt()).isNotNull();
        assertThat(queryService.list(NoteCollection.ACTIVE, NoteSort.UPDATED_DESC, 0, 20).items())
                .noneMatch(item -> item.getId().equals(note.getId()));
        assertThat(queryService.list(NoteCollection.ARCHIVED, NoteSort.UPDATED_DESC, 0, 20).items())
                .noneMatch(item -> item.getId().equals(note.getId()));
    }

    @Test
    void deletedCannotBeArchivedOrPatched() {
        Long owner = createUserId();
        Note note = noteRepository.saveAndFlush(Note.create(owner, "Title", body("Body")));
        setCurrentUser(owner);
        Note deleted = commandService.softDelete(note.getId(), 0L);

        assertThatThrownBy(() -> commandService.archive(note.getId(), deleted.getVersion()))
                .isInstanceOf(NoteNotFoundException.class);
        assertThatThrownBy(
                        () ->
                                commandService.update(
                                        note.getId(),
                                        new NotePatch(
                                                deleted.getVersion(),
                                                FieldUpdate.of("Changed"),
                                                FieldUpdate.absent())))
                .isInstanceOf(NoteNotFoundException.class);
    }

    @Test
    void foreignAndMissingAreIndistinguishableForLifecycleCommands() {
        Long owner = createUserId();
        Long foreignOwner = createUserId();
        Note foreign = noteRepository.saveAndFlush(Note.create(foreignOwner, "Foreign", null));
        setCurrentUser(owner);

        assertThatThrownBy(() -> commandService.archive(-1L, 0L))
                .isInstanceOf(NoteNotFoundException.class);
        assertThatThrownBy(() -> commandService.archive(foreign.getId(), 0L))
                .isInstanceOf(NoteNotFoundException.class);
    }

    @Test
    void softDeleteAndRestorePreservePreviousArchiveInboxAndContent() {
        Long owner = createUserId();
        Note note = noteRepository.saveAndFlush(Note.create(owner, "Title", body("Body")));
        jdbcTemplate.update(
                "UPDATE note SET archived_at = CURRENT_TIMESTAMP, inbox = true WHERE id = ?",
                note.getId());
        entityManager.clear();
        setCurrentUser(owner);

        Note deleted = commandService.softDelete(note.getId(), 0L);
        Note restored = commandService.restoreDeleted(note.getId(), deleted.getVersion());

        assertThat(restored.getVersion()).isEqualTo(2L);
        assertThat(restored.getArchivedAt()).isNotNull();
        assertThat(restored.getDeletedAt()).isNull();
        assertThat(restored.isInbox()).isTrue();
        assertThat(restored.getContent()).isEqualTo(body("Body"));
    }

    private NotePatch noOp(long version) {
        return new NotePatch(version, FieldUpdate.absent(), FieldUpdate.absent());
    }

    private void setCurrentUser(Long userId) {
        SecurityContextHolder.getContext()
                .setAuthentication(new UsernamePasswordAuthenticationToken(userId, "", List.of()));
    }

    private Long createUserId() {
        String suffix = UUID.randomUUID().toString();
        return userCommandService
                .register("note-patch-" + suffix + "@example.com", "StrongPassword123!")
                .id();
    }

    private boolean getResult(Future<Boolean> future) {
        try {
            return future.get(20, TimeUnit.SECONDS);
        } catch (Exception exception) {
            throw new AssertionError(exception);
        }
    }

    private static Map<String, Object> body(String text) {
        return Map.of(
                "type",
                "doc",
                "content",
                List.of(
                        Map.of(
                                "type",
                                "paragraph",
                                "content",
                                List.of(Map.of("type", "text", "text", text)))));
    }
}
