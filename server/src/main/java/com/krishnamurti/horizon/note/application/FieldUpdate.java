package com.krishnamurti.horizon.note.application;

/** Represents a PATCH field that may be omitted or explicitly set to null. */
public record FieldUpdate<T>(boolean present, T value) {

    public static <T> FieldUpdate<T> absent() {
        return new FieldUpdate<>(false, null);
    }

    public static <T> FieldUpdate<T> of(T value) {
        return new FieldUpdate<>(true, value);
    }
}
