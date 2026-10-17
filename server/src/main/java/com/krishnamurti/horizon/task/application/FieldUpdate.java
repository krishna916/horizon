package com.krishnamurti.horizon.task.application;

/** Represents either an omitted value or a supplied value, which may itself be null. */
public record FieldUpdate<T>(boolean present, T value) {

    public static <T> FieldUpdate<T> absent() {
        return new FieldUpdate<>(false, null);
    }

    public static <T> FieldUpdate<T> of(T value) {
        return new FieldUpdate<>(true, value);
    }
}
