package com.krishnamurti.horizon.task.domain;

import jakarta.persistence.AttributeConverter;
import jakarta.persistence.Converter;

/** Maps TaskPriority to its fixed SMALLINT schema code rather than its enum ordinal. */
@Converter
public class TaskPriorityConverter implements AttributeConverter<TaskPriority, Short> {

    @Override
    public Short convertToDatabaseColumn(TaskPriority priority) {
        return priority == null ? null : priority.getDatabaseCode();
    }

    @Override
    public TaskPriority convertToEntityAttribute(Short databaseCode) {
        return TaskPriority.fromDatabaseCode(databaseCode);
    }
}
