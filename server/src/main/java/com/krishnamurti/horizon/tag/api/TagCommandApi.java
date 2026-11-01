package com.krishnamurti.horizon.tag.api;

/** Public commands offered by the Tag module to other modules. */
public interface TagCommandApi {

    TagReference resolveByName(Long userId, String name);
}
