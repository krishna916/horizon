package com.krishnamurti.horizon.note.domain;

import java.net.URI;
import java.net.URISyntaxException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

/** Validates the safe Tiptap document subset accepted by Notes. */
public final class NoteContentPolicy {

    public static final int MAX_SERIALIZED_BYTES = 1_048_576;
    public static final int MAX_DOCUMENT_NODES = 10_000;
    public static final int MAX_NESTING_DEPTH = 32;

    private static final Set<String> BLOCKS =
            Set.of(
                    "paragraph",
                    "heading",
                    "bulletList",
                    "orderedList",
                    "codeBlock",
                    "blockquote",
                    "table",
                    "horizontalRule");
    private static final Set<String> INLINE = Set.of("text", "hardBreak");
    private static final Pattern REL_SEPARATOR = Pattern.compile("\\s+");

    private NoteContentPolicy() {}

    /** Returns a normalized defensive copy, or null for a semantically empty document. */
    public static Map<String, Object> validateAndCopy(Map<String, Object> content) {
        if (content == null) return null;
        if (serializedJsonSize(content) > MAX_SERIALIZED_BYTES)
            invalid("content exceeds the maximum serialized size");
        Counters counters = new Counters();
        validateNode(content, "doc", 1, counters);
        return hasMeaningfulContent(content) ? copyMap(content) : null;
    }

    /** True when normalized content contains text, an intentional table, or a rule. */
    public static boolean hasMeaningfulContent(Map<String, Object> content) {
        if (content == null) return false;
        Deque<Object> pending = new ArrayDeque<>();
        pending.push(content);
        while (!pending.isEmpty()) {
            Map<String, Object> node = asStringMap(pending.pop(), "content nodes must be objects");
            String type = (String) node.get("type");
            if ("table".equals(type) || "horizontalRule".equals(type)) return true;
            if ("text".equals(type)) {
                String text = (String) node.get("text");
                if (!text.codePoints().allMatch(NoteContentPolicy::isWhitespace)) return true;
            }
            Object children = node.get("content");
            if (children instanceof List<?> list) for (Object child : list) pending.push(child);
        }
        return false;
    }

    private static void validateNode(Object value, String expected, int depth, Counters counters) {
        if (depth > MAX_NESTING_DEPTH) invalid("content exceeds the maximum nesting depth");
        if (++counters.nodes > MAX_DOCUMENT_NODES)
            invalid("content exceeds the maximum node count");
        Map<String, Object> node = asStringMap(value, "content nodes must be objects");
        String type = string(node.get("type"), "content node type must be a string");
        if (!expected.equals(type)) invalid("invalid " + expected + " child node");
        validateNodeKeys(node, type);
        if (node.containsKey("attrs")) validateAttrs(node.get("attrs"), type);
        if ("text".equals(type)) {
            string(node.get("text"), "text content must be a string");
            if (node.containsKey("marks")) validateMarks(node.get("marks"), counters);
            return;
        }
        if ("hardBreak".equals(type) || "horizontalRule".equals(type)) {
            if (node.containsKey("content")
                    && !asList(node.get("content"), "leaf content must be an array").isEmpty())
                invalid("leaf nodes cannot contain child nodes");
            return;
        }
        List<?> children =
                node.containsKey("content")
                        ? asList(node.get("content"), "node content must be an array")
                        : List.of();
        validateChildren(type, children, depth, counters);
    }

    private static void validateNodeKeys(Map<String, Object> node, String type) {
        Set<String> allowed =
                switch (type) {
                    case "text" -> Set.of("type", "text", "marks");
                    case "doc" -> Set.of("type", "content");
                    case "paragraph",
                            "heading",
                            "bulletList",
                            "orderedList",
                            "listItem",
                            "codeBlock",
                            "blockquote",
                            "table",
                            "tableRow",
                            "tableCell",
                            "tableHeader" ->
                            Set.of("type", "attrs", "content");
                    case "hardBreak", "horizontalRule" -> Set.of("type", "attrs");
                    default -> throw invalidException("unsupported content node type");
                };
        if (!allowed.containsAll(node.keySet())) invalid("content node has unsupported properties");
        if ("doc".equals(type) && !node.containsKey("content"))
            invalid("document content must be an array");
        if ("text".equals(type) && !node.containsKey("text"))
            invalid("text node content is required");
    }

    private static void validateChildren(
            String type, List<?> children, int depth, Counters counters) {
        switch (type) {
            case "doc" -> validateChildrenAs(children, BLOCKS, depth, counters);
            case "paragraph", "heading" -> validateChildrenAs(children, INLINE, depth, counters);
            case "bulletList", "orderedList" -> {
                requireNonEmpty(children, "lists must contain a list item");
                validateChildrenAs(children, Set.of("listItem"), depth, counters);
            }
            case "listItem" -> {
                requireNonEmpty(children, "list items must contain a paragraph");
                if (!"paragraph".equals(nodeType(children.getFirst())))
                    invalid("list items must start with a paragraph");
                validateChildrenAs(children, BLOCKS, depth, counters);
            }
            case "blockquote" -> {
                requireNonEmpty(children, "block quotes must contain block content");
                validateChildrenAs(children, BLOCKS, depth, counters);
            }
            case "codeBlock" -> validateChildrenAs(children, Set.of("text"), depth, counters);
            case "table" -> {
                requireNonEmpty(children, "tables must contain a row");
                validateChildrenAs(children, Set.of("tableRow"), depth, counters);
            }
            case "tableRow" -> {
                requireNonEmpty(children, "table rows must contain cells");
                validateChildrenAs(children, Set.of("tableCell", "tableHeader"), depth, counters);
            }
            case "tableCell", "tableHeader" -> {
                requireNonEmpty(children, "table cells must contain block content");
                validateChildrenAs(children, BLOCKS, depth, counters);
            }
            default -> invalid("unsupported content node type");
        }
    }

    private static void validateChildrenAs(
            List<?> children, Set<String> allowed, int depth, Counters counters) {
        for (Object child : children) {
            String childType = nodeType(child);
            if (!allowed.contains(childType)) invalid("invalid child placement in content");
            validateNode(child, childType, depth + 1, counters);
        }
    }

    private static void validateMarks(Object value, Counters counters) {
        for (Object item : asList(value, "text marks must be an array")) {
            if (++counters.nodes > MAX_DOCUMENT_NODES)
                invalid("content exceeds the maximum node count");
            Map<String, Object> mark = asStringMap(item, "text marks must be objects");
            String type = string(mark.get("type"), "text mark type must be a string");
            if (!Set.of("bold", "italic", "code", "link").contains(type))
                invalid("unsupported content mark type");
            Set<String> allowed = "link".equals(type) ? Set.of("type", "attrs") : Set.of("type");
            if (!allowed.containsAll(mark.keySet()))
                invalid("content mark has unsupported properties");
            if ("link".equals(type)) validateLinkAttrs(mark.get("attrs"));
        }
    }

    private static void validateAttrs(Object value, String type) {
        Map<String, Object> attrs = asStringMap(value, "node attributes must be an object");
        Set<String> allowed =
                switch (type) {
                    case "heading" -> Set.of("level");
                    case "orderedList" -> Set.of("start", "type");
                    case "codeBlock" -> Set.of("language");
                    case "tableCell", "tableHeader" ->
                            Set.of("colspan", "rowspan", "colwidth", "align");
                    case "paragraph",
                            "bulletList",
                            "listItem",
                            "blockquote",
                            "table",
                            "tableRow",
                            "hardBreak",
                            "horizontalRule" ->
                            Set.of();
                    default -> throw invalidException("unsupported content node attributes");
                };
        if (!allowed.containsAll(attrs.keySet())) invalid("node attributes are not supported");
        switch (type) {
            case "heading" -> {
                Object level = attrs.get("level");
                if (!(level instanceof Number number)
                        || number.intValue() < 1
                        || number.intValue() > 3
                        || number.doubleValue() != number.intValue())
                    invalid("heading level must be between 1 and 3");
            }
            case "orderedList" -> {
                if (attrs.containsKey("start") && !positiveInteger(attrs.get("start")))
                    invalid("ordered list start must be a positive integer");
                Object listType = attrs.get("type");
                if (listType != null
                        && (!(listType instanceof String)
                                || !Set.of("1", "a", "A", "i", "I").contains(listType)))
                    invalid("ordered list type is invalid");
            }
            case "codeBlock" -> {
                Object language = attrs.get("language");
                if (language != null
                        && (!(language instanceof String) || ((String) language).length() > 100))
                    invalid("code block language is invalid");
            }
            case "tableCell", "tableHeader" -> validateCellAttrs(attrs);
            default -> {}
        }
    }

    private static void validateCellAttrs(Map<String, Object> attrs) {
        Object align = attrs.get("align");
        if (align != null
                && (!(align instanceof String)
                        || !Set.of("left", "center", "right").contains(align)))
            invalid("table cell alignment is invalid");
        for (String key : Set.of("colspan", "rowspan"))
            if (attrs.containsKey(key) && !positiveBoundedInteger(attrs.get(key)))
                invalid("table cell span is invalid");
        if (attrs.containsKey("colwidth") && attrs.get("colwidth") != null) {
            for (Object width : asList(attrs.get("colwidth"), "table colwidth must be an array"))
                if (!positiveBoundedInteger(width)) invalid("table column width is invalid");
        }
    }

    private static void validateLinkAttrs(Object value) {
        Map<String, Object> attrs = asStringMap(value, "link attributes must be an object");
        if (!Set.of("href", "target", "rel", "class", "title").containsAll(attrs.keySet())
                || !attrs.containsKey("href")) invalid("link attributes are invalid");
        String href = string(attrs.get("href"), "link href must be a string");
        if (!isSafeHref(href)) invalid("link href must use an absolute http, https, or mailto URL");
        Object target = attrs.get("target");
        if (target != null && !"_blank".equals(target)) invalid("link target is invalid");
        Object rel = attrs.get("rel");
        if (rel != null && !isSafeRel(rel)) invalid("link rel is invalid");
        if (attrs.containsKey("class") && attrs.get("class") != null)
            invalid("link class must be null");
        Object title = attrs.get("title");
        if (title != null && (!(title instanceof String) || ((String) title).length() > 512))
            invalid("link title is invalid");
    }

    private static boolean isSafeHref(String value) {
        if (value.isBlank() || value.codePoints().anyMatch(Character::isISOControl)) return false;
        try {
            URI uri = new URI(value);
            String scheme = uri.getScheme();
            if (!uri.isAbsolute() || scheme == null) return false;
            return switch (scheme.toLowerCase(Locale.ROOT)) {
                case "http", "https" ->
                        uri.getHost() != null
                                && !uri.getHost().isBlank()
                                && uri.getRawUserInfo() == null;
                case "mailto" -> {
                    String address = uri.getRawSchemeSpecificPart();
                    yield address != null && !address.isBlank() && !address.startsWith("//");
                }
                default -> false;
            };
        } catch (URISyntaxException exception) {
            return false;
        }
    }

    private static boolean isSafeRel(Object value) {
        if (!(value instanceof String rel)) return false;
        if (rel.isBlank()) return false;
        Set<String> tokens = new java.util.HashSet<>(List.of(REL_SEPARATOR.split(rel)));
        return Set.of("noopener", "noreferrer", "nofollow").containsAll(tokens)
                && tokens.containsAll(Set.of("noopener", "noreferrer"));
    }

    private static long serializedJsonSize(Object root) {
        long bytes = 0;
        int values = 0;
        Deque<Object> pending = new ArrayDeque<>();
        pending.push(root);
        while (!pending.isEmpty()) {
            Object value = pending.pop();
            if (++values > MAX_DOCUMENT_NODES * 10)
                invalid("content contains too many JSON values");
            if (value == JsonNull.INSTANCE) bytes += 4;
            else if (value instanceof String text) bytes += quotedStringSize(text);
            else if (value instanceof Boolean bool) bytes += bool ? 4 : 5;
            else if (value instanceof Number number) {
                if ((number instanceof Double d && !Double.isFinite(d))
                        || (number instanceof Float f && !Float.isFinite(f)))
                    invalid("content contains a non-JSON number");
                bytes += number.toString().getBytes(StandardCharsets.UTF_8).length;
            } else if (value instanceof Map<?, ?> map) {
                if (map.size() > MAX_DOCUMENT_NODES)
                    invalid("content contains too many JSON properties");
                bytes += 2L + Math.max(0, map.size() - 1);
                for (Map.Entry<?, ?> entry : map.entrySet()) {
                    if (!(entry.getKey() instanceof String))
                        invalid("content object keys must be strings");
                    bytes += quotedStringSize((String) entry.getKey()) + 1;
                    pending.push(entry.getValue() == null ? JsonNull.INSTANCE : entry.getValue());
                }
            } else if (value instanceof List<?> list) {
                if (list.size() > MAX_DOCUMENT_NODES)
                    invalid("content contains too many JSON array values");
                bytes += 2L + Math.max(0, list.size() - 1);
                for (Object item : list) pending.push(item == null ? JsonNull.INSTANCE : item);
            } else invalid("content contains a non-JSON value");
            if (bytes > MAX_SERIALIZED_BYTES) return bytes;
        }
        return bytes;
    }

    private static long quotedStringSize(String value) {
        long bytes = 2;
        for (int offset = 0; offset < value.length(); ) {
            int codePoint = value.codePointAt(offset);
            offset += Character.charCount(codePoint);
            if (codePoint == '"' || codePoint == '\\') bytes += 2;
            else if (codePoint < 0x20) bytes += 6;
            else
                bytes +=
                        new String(Character.toChars(codePoint))
                                .getBytes(StandardCharsets.UTF_8)
                                .length;
        }
        return bytes;
    }

    private static String nodeType(Object value) {
        return string(
                asStringMap(value, "content nodes must be objects").get("type"),
                "node type must be a string");
    }

    private static Map<String, Object> asStringMap(Object value, String message) {
        if (!(value instanceof Map<?, ?>)) invalid(message);
        Map<String, Object> result = new LinkedHashMap<>();
        for (Map.Entry<?, ?> entry : ((Map<?, ?>) value).entrySet()) {
            if (!(entry.getKey() instanceof String)) invalid("content object keys must be strings");
            result.put((String) entry.getKey(), entry.getValue());
        }
        return result;
    }

    private static List<?> asList(Object value, String message) {
        if (!(value instanceof List<?>)) invalid(message);
        return (List<?>) value;
    }

    private static String string(Object value, String message) {
        if (!(value instanceof String)) invalid(message);
        return (String) value;
    }

    private static boolean positiveInteger(Object value) {
        return value instanceof Number number
                && number.intValue() > 0
                && number.doubleValue() == number.intValue();
    }

    private static boolean positiveBoundedInteger(Object value) {
        return positiveInteger(value) && ((Number) value).intValue() <= 100;
    }

    private static void requireNonEmpty(List<?> values, String message) {
        if (values.isEmpty()) invalid(message);
    }

    private static boolean isWhitespace(int codePoint) {
        return Character.isWhitespace(codePoint) || Character.isSpaceChar(codePoint);
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> copyMap(Map<String, Object> value) {
        return (Map<String, Object>) copyValue(value);
    }

    private static Object copyValue(Object value) {
        if (value instanceof Map<?, ?> map) {
            Map<String, Object> copy = new LinkedHashMap<>();
            map.forEach((key, nested) -> copy.put((String) key, copyValue(nested)));
            return copy;
        }
        if (value instanceof List<?> list) {
            List<Object> copy = new ArrayList<>(list.size());
            list.forEach(item -> copy.add(copyValue(item)));
            return copy;
        }
        return value;
    }

    private static void invalid(String message) {
        throw invalidException(message);
    }

    private static InvalidNoteException invalidException(String message) {
        return new InvalidNoteException("content", message);
    }

    private static final class Counters {
        private int nodes;
    }

    private enum JsonNull {
        INSTANCE
    }
}
