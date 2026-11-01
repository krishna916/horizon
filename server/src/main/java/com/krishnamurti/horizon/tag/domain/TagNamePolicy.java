package com.krishnamurti.horizon.tag.domain;

/** Shared input normalization for Tag names and suggestion prefixes. */
public final class TagNamePolicy {

    public static final int MAX_NAME_CODE_POINTS = 100;

    private TagNamePolicy() {}

    public static String normalizeRequiredName(String name) {
        String normalized = normalize(name);
        if (normalized.isEmpty()) {
            throw new InvalidTagException("name", "name must not be blank");
        }
        return normalized;
    }

    public static String normalizeSuggestionPrefix(String prefix) {
        return normalize(prefix);
    }

    private static String normalize(String value) {
        if (value == null) {
            throw new InvalidTagException("name", "name is required");
        }
        if (value.codePoints().anyMatch(Character::isISOControl)) {
            throw new InvalidTagException("name", "name must not contain control characters");
        }

        String trimmed = trimEdgeSpaces(value);
        if (trimmed.codePointCount(0, trimmed.length()) > MAX_NAME_CODE_POINTS) {
            throw new InvalidTagException("name", "name must be at most 100 Unicode code points");
        }
        return trimmed;
    }

    private static String trimEdgeSpaces(String value) {
        int start = 0;
        int end = value.length();

        while (start < end) {
            int codePoint = value.codePointAt(start);
            if (!isEdgeSpace(codePoint)) {
                break;
            }
            start += Character.charCount(codePoint);
        }
        while (end > start) {
            int codePoint = value.codePointBefore(end);
            if (!isEdgeSpace(codePoint)) {
                break;
            }
            end -= Character.charCount(codePoint);
        }
        return value.substring(start, end);
    }

    private static boolean isEdgeSpace(int codePoint) {
        return Character.isWhitespace(codePoint) || Character.isSpaceChar(codePoint);
    }
}
