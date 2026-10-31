package com.krishnamurti.horizon.tag.infrastructure;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.krishnamurti.horizon.HorizonApplication;
import com.krishnamurti.horizon.TestcontainersConfiguration;
import com.krishnamurti.horizon.tag.domain.Tag;
import jakarta.persistence.EntityManager;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;

@SpringBootTest(
        classes = HorizonApplication.class,
        properties = "spring.jpa.hibernate.ddl-auto=validate")
@Import(TestcontainersConfiguration.class)
class TagRepositoryIntegrationTest {

    @Autowired private JdbcTemplate jdbcTemplate;
    @Autowired private EntityManager entityManager;
    @Autowired private TagRepository tagRepository;

    @Test
    void persistsAndReloadsTagWithoutContentReference() {
        Long ownerId = createUserId();
        Tag saved = tagRepository.saveAndFlush(Tag.create(ownerId, "  Horizon  "));
        entityManager.clear();

        Tag reloaded = tagRepository.findByIdAndUserId(saved.getId(), ownerId).orElseThrow();

        assertThat(reloaded.getId()).isEqualTo(saved.getId());
        assertThat(reloaded.getUserId()).isEqualTo(ownerId);
        assertThat(reloaded.getName()).isEqualTo("Horizon");
        assertThat(reloaded.getCreatedAt()).isNotNull();
        assertThat(reloaded.getUpdatedAt()).isNotNull();
        assertThat(countTags(saved.getId())).isEqualTo(1);
    }

    @Test
    void ownerScopedLookupHidesAnotherUsersTag() {
        Long ownerId = createUserId();
        Long otherOwnerId = createUserId();
        Tag saved = tagRepository.saveAndFlush(Tag.create(ownerId, "Horizon"));
        entityManager.clear();

        assertThat(tagRepository.findByIdAndUserId(saved.getId(), otherOwnerId)).isEmpty();
    }

    @Test
    void differentOwnersCanPersistSameName() {
        Long firstOwnerId = createUserId();
        Long secondOwnerId = createUserId();

        Tag first = tagRepository.saveAndFlush(Tag.create(firstOwnerId, "Horizon"));
        Tag second = tagRepository.saveAndFlush(Tag.create(secondOwnerId, "Horizon"));

        assertThat(first.getId()).isNotEqualTo(second.getId());
        assertThat(countTags(first.getId())).isEqualTo(1);
        assertThat(countTags(second.getId())).isEqualTo(1);
    }

    @Test
    void sameOwnerCannotPersistCaseVariant() {
        Long ownerId = createUserId();
        tagRepository.saveAndFlush(Tag.create(ownerId, "Horizon"));

        assertThatThrownBy(() -> tagRepository.saveAndFlush(Tag.create(ownerId, "horizon")))
                .isInstanceOf(DataIntegrityViolationException.class);
    }

    private Long createUserId() {
        return jdbcTemplate.queryForObject(
                "INSERT INTO users (email, password_hash, created_at, updated_at) VALUES (?,"
                        + " 'test-hash', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) RETURNING id",
                Long.class,
                UUID.randomUUID() + "@example.com");
    }

    private Integer countTags(Long tagId) {
        return jdbcTemplate.queryForObject(
                "SELECT count(*) FROM tag WHERE id = ?", Integer.class, tagId);
    }
}
