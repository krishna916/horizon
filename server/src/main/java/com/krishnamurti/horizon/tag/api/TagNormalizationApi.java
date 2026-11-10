package com.krishnamurti.horizon.tag.api;

/** Read-only normalization policy exposed for other modules' request fingerprints. */
public interface TagNormalizationApi {

    String normalizeName(String name);
}
