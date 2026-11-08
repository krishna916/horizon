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
        for (Object sourceBlock : sourceBlocks) {
            if (previewBlocks.size() >= MAX_TOP_LEVEL_BLOCKS || textBudget.remaining() == 0) break;
            TextBudget candidateTextBudget = new TextBudget(textBudget.remaining());
            Map<String, Object> block = copyNode(asMap(sourceBlock), candidateTextBudget);
            if (block == null) break;
            while (true) {
                List<Map<String, Object>> candidateBlocks = new ArrayList<>(previewBlocks);
                candidateBlocks.add(block);
                Map<String, Object> candidate = document(candidateBlocks);
                if (NoteContentPolicy.serializedJsonSize(candidate) <= MAX_SERIALIZED_BYTES) {
                    try {
                        NoteContentPolicy.validateAndCopy(candidate);
                        break;
                    } catch (RuntimeException invalidPreview) {
                        // Keep trimming this block until its remaining prefix is structurally
                        // valid.
                    }
                }
                if (!removeLastDescendant(block)) {
                    block = null;
                    break;
                }
            }
            if (block == null) break;
            previewBlocks.add(block);
            textBudget.consume(textLength(block));
        }
        Map<String, Object> preview = document(previewBlocks);
        return NoteContentPolicy.hasMeaningfulContent(preview) ? preview : null;
    }

    private Map<String, Object> copyNode(Map<String, Object> source, TextBudget budget) {
        Map<String, Object> result = new LinkedHashMap<>();
        source.forEach(
                (key, value) -> {
                    if (!CONTENT.equals(key) && !TEXT.equals(key)) result.put(key, value);
                });
        if (TEXT.equals(source.get(TYPE))) {
            String text = (String) source.get(TEXT);
            String prefix = takeGraphemes(text, budget.remaining());
            budget.consume(prefix.length());
            if (prefix.isEmpty()) return null;
            result.put(TEXT, prefix);
            return result;
        }
        Object children = source.get(CONTENT);
        if (children instanceof List<?> sourceChildren) {
            List<Map<String, Object>> copiedChildren = copyChildren(sourceChildren, budget);
            if (!copiedChildren.isEmpty() || allowsEmptyContent((String) source.get("type"))) {
                result.put(CONTENT, copiedChildren);
            } else {
                return null;
            }
        }
        return result;
    }

    private List<Map<String, Object>> copyChildren(List<?> sourceChildren, TextBudget budget) {
        List<Map<String, Object>> copiedChildren = new ArrayList<>();
        for (Object child : sourceChildren) {
            if (budget.remaining() == 0) break;
            Map<String, Object> copied = copyNode(asMap(child), budget);
            if (copied != null) copiedChildren.add(copied);
        }
        return copiedChildren;
    }

    private static boolean removeLastDescendant(Map<String, Object> node) {
        Object value = node.get(CONTENT);
        if (!(value instanceof List<?> children) || children.isEmpty()) return false;
        @SuppressWarnings("unchecked")
        List<Object> mutableChildren = (List<Object>) children;
        Object last = mutableChildren.getLast();
        if (last instanceof Map<?, ?> lastMap
                && removeLastDescendant((Map<String, Object>) lastMap)) return true;
        mutableChildren.removeLast();
        return true;
    }

    private static int textLength(Object node) {
        if (!(node instanceof Map<?, ?> map)) return 0;
        int length = map.get(TEXT) instanceof String text ? text.length() : 0;
        Object children = map.get(CONTENT);
        if (children instanceof List<?> list) {
            for (Object child : list) length += textLength(child);
        }
        return length;
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
    }
}
