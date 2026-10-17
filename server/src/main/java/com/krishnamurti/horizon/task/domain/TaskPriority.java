package com.krishnamurti.horizon.task.domain;

/** User-managed task priority with stable persistence codes. */
public enum TaskPriority {
    CRITICAL((short) 1),
    HIGH((short) 2),
    MEDIUM((short) 3),
    LOW((short) 4);

    private final short databaseCode;

    TaskPriority(short databaseCode) {
        this.databaseCode = databaseCode;
    }

    public short getDatabaseCode() {
        return databaseCode;
    }

    public static TaskPriority fromDatabaseCode(Short databaseCode) {
        if (databaseCode == null) {
            return null;
        }
        for (TaskPriority priority : values()) {
            if (priority.databaseCode == databaseCode) {
                return priority;
            }
        }
        throw new IllegalArgumentException("Unknown task priority code: " + databaseCode);
    }
}
