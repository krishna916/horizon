package com.krishnamurti.horizon.tag.web;

import com.krishnamurti.horizon.shared.security.CurrentUserProvider;
import com.krishnamurti.horizon.tag.api.TagQueryApi;
import com.krishnamurti.horizon.tag.api.TagReference;
import java.util.List;
import org.springframework.security.authentication.InsufficientAuthenticationException;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** Authenticated read-only HTTP adapter for Tag suggestions. */
@RestController
@RequestMapping("/api/v1/tags")
public class TagController {

    private final TagQueryApi tagQueryApi;
    private final CurrentUserProvider currentUserProvider;

    public TagController(TagQueryApi tagQueryApi, CurrentUserProvider currentUserProvider) {
        this.tagQueryApi = tagQueryApi;
        this.currentUserProvider = currentUserProvider;
    }

    @GetMapping("/suggestions")
    public TagSuggestionsResponse suggest(
            @RequestParam(name = "q", required = false) String prefix) {
        if (prefix == null) {
            throw new TagRequestValidationException("q", "A suggestion prefix is required.");
        }

        Long userId =
                currentUserProvider
                        .getCurrentUserId()
                        .orElseThrow(
                                () ->
                                        new InsufficientAuthenticationException(
                                                "An authenticated user is required."));
        List<TagReference> items = tagQueryApi.suggest(userId, prefix);
        return new TagSuggestionsResponse(items);
    }
}
