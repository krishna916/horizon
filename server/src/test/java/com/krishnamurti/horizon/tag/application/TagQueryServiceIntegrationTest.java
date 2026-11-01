package com.krishnamurti.horizon.tag.application;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.krishnamurti.horizon.HorizonApplication;
import com.krishnamurti.horizon.TestcontainersConfiguration;
import com.krishnamurti.horizon.tag.api.InvalidTagNameException;
import com.krishnamurti.horizon.tag.api.TagReference;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;

@SpringBootTest(
        classes = HorizonApplication.class,
        properties = "spring.jpa.hibernate.ddl-auto=validate")
@Import(TestcontainersConfiguration.class)
class TagQueryServiceIntegrationTest {

    @Autowired private TagQueryService tagQueryService;
    @Autowired private JdbcTemplate jdbcTemplate;

    @Test
    void idLookupReturnsOwnerTagAndHidesMissingOrForeignTags() {
        Long ownerId = createUserId();
        Long otherOwnerId = createUserId();
        Long tagId = insertTag(ownerId, "Horizon");

        assertThat(tagQueryService.findById(ownerId, tagId))
                .contains(new TagReference(tagId, "Horizon"));
        assertThat(tagQueryService.findById(otherOwnerId, tagId)).isEmpty();
        assertThat(tagQueryService.findById(ownerId, Long.MAX_VALUE)).isEmpty();
    }

    @Test
    void suggestionsAreOwnerScopedCaseInsensitiveLiteralPrefixAndIncludeUnusedTags() {
        Long ownerId = createUserId();
        Long otherOwnerId = createUserId();
        Long horizonId = insertTag(ownerId, "Horizon");
        Long backendId = insertTag(ownerId, "HorizonBackend");
        insertTag(ownerId, "MyHorizon");
        insertTag(otherOwnerId, "Horizon Private");

        assertThat(tagQueryService.suggest(ownerId, "HOR"))
                .containsExactly(
                        new TagReference(horizonId, "Horizon"),
                        new TagReference(backendId, "HorizonBackend"));
        assertThat(tagQueryService.suggest(ownerId, "h"))
                .extracting(TagReference::name)
                .contains("Horizon", "HorizonBackend")
                .doesNotContain("MyHorizon", "Horizon Private");
    }

    @Test
    void suggestionsTrimSpacesAndReturnNoResultsForBlankPrefixes() {
        Long ownerId = createUserId();
        Long tagId = insertTag(ownerId, "Horizon");

        assertThat(tagQueryService.suggest(ownerId, "  hor  "))
                .containsExactly(new TagReference(tagId, "Horizon"));
        assertThat(tagQueryService.suggest(ownerId, "")).isEmpty();
        assertThat(tagQueryService.suggest(ownerId, "   ")).isEmpty();
        assertThat(tagQueryService.suggest(ownerId, "\u00a0")).isEmpty();
    }

    @Test
    void rejectsControlAndPrefixesLongerThanOneHundredCodePoints() {
        Long ownerId = createUserId();

        for (String prefix : new String[] {"\t", "Name\n", "😀".repeat(101)}) {
            assertThatThrownBy(() -> tagQueryService.suggest(ownerId, prefix))
                    .isInstanceOfSatisfying(
                            InvalidTagNameException.class,
                            exception -> assertThat(exception.getField()).isEqualTo("prefix"));
        }

        assertThat(tagQueryService.suggest(ownerId, "😀".repeat(100))).isEmpty();
    }

    @Test
    void escapesLikeMetacharactersAndBackslashAsLiteralPrefixCharacters() {
        Long ownerId = createUserId();
        Long percentId = insertTag(ownerId, "h%literal");
        Long underscoreId = insertTag(ownerId, "h_literal");
        Long slashId = insertTag(ownerId, "h\\literal");
        Long exclamationId = insertTag(ownerId, "h!literal");
        insertTag(ownerId, "hXliteral");
        insertTag(ownerId, "h/literal");

        assertThat(tagQueryService.suggest(ownerId, "h%"))
                .containsExactly(new TagReference(percentId, "h%literal"));
        assertThat(tagQueryService.suggest(ownerId, "h_"))
                .containsExactly(new TagReference(underscoreId, "h_literal"));
        assertThat(tagQueryService.suggest(ownerId, "h\\"))
                .containsExactly(new TagReference(slashId, "h\\literal"));
        assertThat(tagQueryService.suggest(ownerId, "h!"))
                .containsExactly(new TagReference(exclamationId, "h!literal"));
    }

    @Test
    void returnsFirstTenResultsInStableAlphabeticalOrder() {
        Long ownerId = createUserId();
        for (char suffix = 'l'; suffix >= 'a'; suffix--) {
            insertTag(ownerId, "Horizon " + suffix);
        }

        assertThat(tagQueryService.suggest(ownerId, "horizon "))
                .extracting(TagReference::name)
                .containsExactly(
                        "Horizon a",
                        "Horizon b",
                        "Horizon c",
                        "Horizon d",
                        "Horizon e",
                        "Horizon f",
                        "Horizon g",
                        "Horizon h",
                        "Horizon i",
                        "Horizon j");
    }

    private Long createUserId() {
        return jdbcTemplate.queryForObject(
                "INSERT INTO users (email, password_hash, created_at, updated_at) VALUES (?,"
                        + " 'test-hash', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) RETURNING id",
                Long.class,
                UUID.randomUUID() + "@example.com");
    }

    private Long insertTag(Long userId, String name) {
        return jdbcTemplate.queryForObject(
                "INSERT INTO tag (user_id, name, created_at, updated_at) "
                        + "VALUES (?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) RETURNING id",
                Long.class,
                userId,
                name);
    }
}
