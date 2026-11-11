package com.krishnamurti.horizon.tag.application;

import com.krishnamurti.horizon.tag.api.InvalidTagNameException;
import com.krishnamurti.horizon.tag.api.TagNormalizationApi;
import com.krishnamurti.horizon.tag.domain.InvalidTagException;
import com.krishnamurti.horizon.tag.domain.TagNamePolicy;
import org.springframework.stereotype.Service;

/** Exposes the shared Tag name policy without exposing Tag domain internals. */
@Service
public class TagNormalizationService implements TagNormalizationApi {

    @Override
    public String normalizeName(String name) {
        try {
            return TagNamePolicy.normalizeRequiredName(name);
        } catch (InvalidTagException exception) {
            throw new InvalidTagNameException(exception.getField(), exception.getMessage());
        }
    }
}
