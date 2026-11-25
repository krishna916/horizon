package com.krishnamurti.horizon.file.application.port;

/** Metadata returned by HEAD; found=false means the provider conclusively reported absence. */
public record ObjectMetadata(boolean found, long contentLength, String contentType) {

    public ObjectMetadata {
        if (found) {
            if (contentLength < 0 || contentType == null || contentType.isBlank()) {
                throw new IllegalArgumentException(
                        "Found object metadata requires length and media type");
            }
        } else if (contentLength != 0 || contentType != null) {
            throw new IllegalArgumentException(
                    "Missing object metadata cannot carry object attributes");
        }
    }

    public static ObjectMetadata missing() {
        return new ObjectMetadata(false, 0, null);
    }
}
