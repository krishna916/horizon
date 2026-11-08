package com.krishnamurti.horizon.note.domain;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Builds a small, valid Tiptap document suitable for collection responses. */
public class NotePreviewBuilder {

    private static final String CONTENT = "content";
    private static final String TYPE = "type";
    private static final String TEXT = "text";
    private static final int MAX_TEXT_CHARACTERS = 520;
    private static final int MAX_TOP_LEVEL_BLOCKS = 6;
    private static final int MAX_SERIALIZED_BYTES = 16 * 1024;

    public Map<String, Object> build(Map<String, Object> document) {
        if (document == null || !NoteContentPolicy.hasMeaningfulContent(document)) return null;
        List<?> sourceBlocks = (List<?>) document.get(CONTENT);
        List<Map<String, Object>> previewBlocks = new ArrayList<>();
        TextBudget textBudget = new TextBudget(MAX_TEXT_CHARACTERS);
        CopyState state = new CopyState();
        long remainingBytes = MAX_SERIALIZED_BYTES - serializedSize(document(List.of()));
        for (Object sourceBlock : sourceBlocks) {
            if (previewBlocks.size() >= MAX_TOP_LEVEL_BLOCKS
                    || textBudget.remaining() == 0
                    || state.stopped) break;
            long separatorBytes = previewBlocks.isEmpty() ? 0 : 1;
            CopyResult copied =
                    copyNode(
                            asMap(sourceBlock), textBudget, remainingBytes - separatorBytes, state);
            if (copied == null) break;
            previewBlocks.add(copied.node());
            remainingBytes -= copied.serializedBytes() + separatorBytes;
        }
        Map<String, Object> preview = document(previewBlocks);
        try {
            if (serializedSize(preview) > MAX_SERIALIZED_BYTES) return null;
            NoteContentPolicy.validateAndCopy(preview);
            return NoteContentPolicy.hasMeaningfulContent(preview) ? preview : null;
        } catch (RuntimeException invalidPreview) {
            return null;
        }
    }

    private CopyResult copyNode(
            Map<String, Object> source, TextBudget budget, long maxBytes, CopyState state) {
        int textCheckpoint = budget.remaining();
        Map<String, Object> result = new LinkedHashMap<>();
        source.forEach(
                (key, value) -> {
                    if (!CONTENT.equals(key) && !TEXT.equals(key)) result.put(key, value);
                });
        if (TEXT.equals(source.get(TYPE))) {
            String prefix =
                    takeGraphemesWithinBudget(
                            result, (String) source.get(TEXT), budget.remaining(), maxBytes);
            budget.consume(prefix.length());
            if (prefix.isEmpty()) {
                state.stopped = true;
                return null;
            }
            result.put(TEXT, prefix);
            if (prefix.length() < ((String) source.get(TEXT)).length()) state.stopped = true;
            return new CopyResult(result, serializedSize(result));
        }
        Object children = source.get(CONTENT);
        if (children instanceof List<?> sourceChildren) {
            List<Map<String, Object>> copiedChildren = new ArrayList<>();
            result.put(CONTENT, copiedChildren);
            long nodeBytes = serializedSize(result);
            if (nodeBytes > maxBytes) {
                budget.restore(textCheckpoint);
                state.stopped = true;
                return null;
            }
            long availableChildBytes = maxBytes - nodeBytes;
            for (Object sourceChild : sourceChildren) {
                if (budget.remaining() == 0) {
                    state.stopped = true;
                    break;
                }
                long separatorBytes = copiedChildren.isEmpty() ? 0 : 1;
                CopyResult copied =
                        copyNode(
                                asMap(sourceChild),
                                budget,
                                availableChildBytes - separatorBytes,
                                state);
                if (copied == null) {
                    state.stopped = true;
                    break;
                }
                copiedChildren.add(copied.node());
                long childCost = copied.serializedBytes() + separatorBytes;
                nodeBytes += childCost;
                availableChildBytes -= childCost;
                if (state.stopped) break;
            }
            if (!copiedChildren.isEmpty() || allowsEmptyContent((String) source.get("type"))) {
                return new CopyResult(result, nodeBytes);
            } else {
                budget.restore(textCheckpoint);
                return null;
            }
        }
        long nodeBytes = serializedSize(result);
        if (nodeBytes > maxBytes) {
            budget.restore(textCheckpoint);
            state.stopped = true;
            return null;
        }
        return new CopyResult(result, nodeBytes);
    }

    private static String takeGraphemesWithinBudget(
            Map<String, Object> attributes, String value, int maxCharacters, long maxBytes) {
        int offset = 0;
        while (offset < value.length()) {
            int next = nextGraphemeEnd(value, offset);
            if (next > maxCharacters) break;
            Map<String, Object> candidate = new LinkedHashMap<>(attributes);
            candidate.put(TEXT, value.substring(0, next));
            if (serializedSize(candidate) > maxBytes) break;
            offset = next;
        }
        return value.substring(0, offset);
    }

    private static long serializedSize(Object value) {
        return NoteContentPolicy.serializedJsonSize(value);
    }

    private static boolean allowsEmptyContent(String type) {
        return switch (type) {
            case "paragraph", "heading", "codeBlock" -> true;
            default -> false;
        };
    }

    private static String takeGraphemes(String value, int maxCharacters) {
        int offset = 0;
        int consumed = 0;
        while (offset < value.length()) {
            int next = nextGraphemeEnd(value, offset);
            int length = next - offset;
            if (consumed + length > maxCharacters) break;
            consumed += length;
            offset = next;
        }
        return value.substring(0, offset);
    }

    private static int nextGraphemeEnd(String text, int start) {
        int offset = start;
        int first = text.codePointAt(offset);
        offset += Character.charCount(first);
        boolean regionalIndicator = isRegionalIndicator(first);
        if (regionalIndicator && offset < text.length()) {
            int next = text.codePointAt(offset);
            if (isRegionalIndicator(next)) offset += Character.charCount(next);
        }
        while (offset < text.length()) {
            int codePoint = text.codePointAt(offset);
            int type = Character.getType(codePoint);
            if (type == Character.NON_SPACING_MARK
                    || type == Character.COMBINING_SPACING_MARK
                    || type == Character.ENCLOSING_MARK
                    || isVariationSelector(codePoint)
                    || isEmojiModifier(codePoint)) {
                offset += Character.charCount(codePoint);
                continue;
            }
            if (codePoint == 0x200D) {
                offset += Character.charCount(codePoint);
                if (offset < text.length()) offset += Character.charCount(text.codePointAt(offset));
                continue;
            }
            break;
        }
        return offset;
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> asMap(Object value) {
        return (Map<String, Object>) value;
    }

    private static Map<String, Object> document(List<Map<String, Object>> blocks) {
        return Map.of("type", "doc", CONTENT, List.copyOf(blocks));
    }

    private static boolean isRegionalIndicator(int codePoint) {
        return codePoint >= 0x1F1E6 && codePoint <= 0x1F1FF;
    }

    private static boolean isVariationSelector(int codePoint) {
        return (codePoint >= 0xFE00 && codePoint <= 0xFE0F)
                || (codePoint >= 0xE0100 && codePoint <= 0xE01EF);
    }

    private static boolean isEmojiModifier(int codePoint) {
        return codePoint >= 0x1F3FB && codePoint <= 0x1F3FF;
    }

    private static final class TextBudget {
        private int remaining;

        TextBudget(int remaining) {
            this.remaining = remaining;
        }

        int remaining() {
            return remaining;
        }

        void consume(int characters) {
            remaining -= characters;
        }

        void restore(int value) {
            remaining = value;
        }
    }

    private static final class CopyState {
        private boolean stopped;
    }

    private record CopyResult(Map<String, Object> node, long serializedBytes) {}
}
