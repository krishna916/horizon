package com.krishnamurti.horizon.tag.api;

/** Public commands offered by the Tag module to other modules. */
public interface TagCommandApi {

    /**
     * Resolves a name for the authenticated user, creating a Tag when none exists.
     *
     * <p>The caller must provide the authenticated user's ID and an existing writable PostgreSQL
     * {@code READ_COMMITTED} transaction. This operation requires {@code Propagation.MANDATORY};
     * any created Tag participates in that transaction and rolls back if the enclosing use case
     * fails.
     */
    TagReference resolveByName(Long userId, String name);
}
