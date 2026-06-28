package com.krishnamurti.horizon.user.domain;

import com.krishnamurti.horizon.shared.domain.BaseEntity;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

/**
 * UserSettings aggregate root/entity.
 *
 * <p>Represents settings/preferences associated with a registered user.
 */
@Entity
@Table(name = "user_settings")
@Getter
@Setter
public class UserSettings extends BaseEntity {

    @OneToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "user_id", nullable = false, unique = true)
    private User user;

    @Column(name = "theme", nullable = false, length = 20)
    private String theme = "SYSTEM";

    /** JPA constructor. */
    protected UserSettings() {}

    /**
     * Factory method for creating default UserSettings.
     *
     * @param user the user these settings belong to
     * @return default user settings
     */
    public static UserSettings createDefault(User user) {
        UserSettings settings = new UserSettings();
        settings.user = user;
        settings.theme = "SYSTEM";
        return settings;
    }
}
