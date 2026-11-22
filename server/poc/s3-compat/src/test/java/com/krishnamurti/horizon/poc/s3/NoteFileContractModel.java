package com.krishnamurti.horizon.poc.s3;

import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/** Behavioral contract model only; it is not wired to Horizon Note production code. */
final class NoteFileContractModel {

    enum Lifecycle { ACTIVE, ARCHIVED, TRASHED }

    private final Set<UUID> associations = new HashSet<>();
    private final Map<UUID, Integer> inlineReferenceCounts = new HashMap<>();
    private long version;
    private Lifecycle lifecycle = Lifecycle.ACTIVE;
    private String body = "";
    private boolean physicalBytesPresent;

    void addFile(UUID fileId, boolean hasPhysicalBytes) {
        associations.add(fileId);
        physicalBytesPresent |= hasPhysicalBytes;
    }

    void insertInlineReference(UUID fileId) {
        associations.add(fileId);
        inlineReferenceCounts.merge(fileId, 1, Integer::sum);
        version++;
    }

    void ordinaryPatch(String replacementBody) {
        body = replacementBody;
        version++;
    }

    void removeInlineReference(UUID fileId) {
        int count = inlineReferenceCounts.getOrDefault(fileId, 0);
        if (count == 0) throw new IllegalArgumentException("no inline reference exists");
        if (count == 1) {
            inlineReferenceCounts.remove(fileId);
            associations.remove(fileId);
        } else {
            inlineReferenceCounts.put(fileId, count - 1);
        }
        version++;
    }

    void archive() { lifecycle = Lifecycle.ARCHIVED; }

    void trash() { lifecycle = Lifecycle.TRASHED; }

    void restore() { lifecycle = Lifecycle.ACTIVE; }

    boolean canReadOrdinarily() { return lifecycle != Lifecycle.TRASHED; }

    int associationCount() { return associations.size(); }

    int inlineReferenceCount(UUID fileId) { return inlineReferenceCounts.getOrDefault(fileId, 0); }

    boolean associated(UUID fileId) { return associations.contains(fileId); }

    boolean physicalBytesPresent() { return physicalBytesPresent; }

    long version() { return version; }

    Lifecycle lifecycle() { return lifecycle; }

    String body() { return body; }
}
