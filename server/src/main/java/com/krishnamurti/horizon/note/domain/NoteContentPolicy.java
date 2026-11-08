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

    private static final String TYPE = "type";
    private static final String CONTENT = "content";
    private static final String ATTRS = "attrs";
    private static final String MARKS = "marks";
    private static final String PARAGRAPH = "paragraph";
    private static final String HEADING = "heading";
    private static final String ORDERED_LIST = "orderedList";
    private static final String CODE_BLOCK = "codeBlock";
    private static final String BLOCKQUOTE = "blockquote";
    private static final String TABLE = "table";
    private static final String TABLE_ROW = "tableRow";
    private static final String TABLE_CELL = "tableCell";
    private static final String TABLE_HEADER = "tableHeader";
    private static final String LIST_ITEM = "listItem";
    private static final String HARD_BREAK = "hardBreak";
    private static final String HORIZONTAL_RULE = "horizontalRule";
    private static final String BULLET_LIST = "bulletList";
    private static final String ORDERED_LIST_START = "start";
    private static final String CLASS = "class";
    private static final String COLWIDTH = "colwidth";
    private static final String CONTENT_NODES_MUST_BE_OBJECTS = "content nodes must be objects";

    private static final Set<String> BLOCKS =
            Set.of(
                    PARAGRAPH,
                    HEADING,
                    BULLET_LIST,
                    ORDERED_LIST,
                    CODE_BLOCK,
                    BLOCKQUOTE,
                    TABLE,
                    HORIZONTAL_RULE);
    private static final Set<String> INLINE = Set.of("text", HARD_BREAK);
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
            Map<String, Object> node = asStringMap(pending.pop(), CONTENT_NODES_MUST_BE_OBJECTS);
            String type = (String) node.get(TYPE);
            if (TABLE.equals(type) || HORIZONTAL_RULE.equals(type)) return true;
            if ("text".equals(type)) {
                String text = (String) node.get("text");
                if (!text.codePoints().allMatch(NoteContentPolicy::isWhitespace)) return true;
            }
            Object children = node.get(CONTENT);
            if (children instanceof List<?> list) for (Object child : list) pending.push(child);
        }
        return false;
    }

    private static void validateNode(Object value, String expected, int depth, Counters counters) {
        if (depth > MAX_NESTING_DEPTH) invalid("content exceeds the maximum nesting depth");
        // The root doc is a structural node and consumes one slot in the document budget.
        if (++counters.nodes > MAX_DOCUMENT_NODES)
            invalid("content exceeds the maximum node count");
        Map<String, Object> node = asStringMap(value, CONTENT_NODES_MUST_BE_OBJECTS);
        String type = string(node.get(TYPE), "content node type must be a string");
        if (!expected.equals(type)) invalid("invalid " + expected + " child node");
        validateNodeKeys(node, type);
        if (node.containsKey(ATTRS)) validateAttrs(node.get(ATTRS), type);
        if ("text".equals(type)) {
            string(node.get("text"), "text content must be a string");
            if (node.containsKey(MARKS)) validateMarks(node.get(MARKS), counters);
            return;
        }
        if (HARD_BREAK.equals(type) || HORIZONTAL_RULE.equals(type)) {
            if (node.containsKey(CONTENT)
                    && !asList(node.get(CONTENT), "leaf content must be an array").isEmpty())
                invalid("leaf nodes cannot contain child nodes");
            return;
        }
        List<?> children =
                node.containsKey(CONTENT)
                        ? asList(node.get(CONTENT), "node content must be an array")
                        : List.of();
        validateChildren(type, children, depth, counters);
    }

    private static void validateNodeKeys(Map<String, Object> node, String type) {
        Set<String> allowed =
                switch (type) {
                    case "text" -> Set.of(TYPE, "text", MARKS);
                    case "doc" -> Set.of(TYPE, CONTENT);
                    case PARAGRAPH,
                            HEADING,
                            BULLET_LIST,
                            ORDERED_LIST,
                            LIST_ITEM,
                            CODE_BLOCK,
                            BLOCKQUOTE,
                            TABLE,
                            TABLE_ROW,
                            TABLE_CELL,
                            TABLE_HEADER ->
                            Set.of(TYPE, ATTRS, CONTENT);
                    case HARD_BREAK, HORIZONTAL_RULE -> Set.of(TYPE, ATTRS);
                    default -> throw invalidException("unsupported content node type");
                };
        if (!allowed.containsAll(node.keySet())) invalid("content node has unsupported properties");
        if ("doc".equals(type) && !node.containsKey(CONTENT))
            invalid("document content must be an array");
        if ("text".equals(type) && !node.containsKey("text"))
            invalid("text node content is required");
    }

    private static void validateChildren(
            String type, List<?> children, int depth, Counters counters) {
        switch (type) {
            case "doc" -> validateChildrenAs(children, BLOCKS, depth, counters);
            case PARAGRAPH, HEADING -> validateChildrenAs(children, INLINE, depth, counters);
            case BULLET_LIST, ORDERED_LIST -> {
                requireNonEmpty(children, "lists must contain a list item");
                validateChildrenAs(children, Set.of(LIST_ITEM), depth, counters);
            }
            case LIST_ITEM -> {
                requireNonEmpty(children, "list items must contain a paragraph");
                if (!PARAGRAPH.equals(nodeType(children.getFirst())))
                    invalid("list items must start with a paragraph");
                validateChildrenAs(children, BLOCKS, depth, counters);
            }
            case BLOCKQUOTE -> {
                requireNonEmpty(children, "block quotes must contain block content");
                validateChildrenAs(children, BLOCKS, depth, counters);
            }
            case CODE_BLOCK -> validateChildrenAs(children, Set.of("text"), depth, counters);
            case TABLE -> {
                requireNonEmpty(children, "tables must contain a row");
                validateChildrenAs(children, Set.of(TABLE_ROW), depth, counters);
            }
            case TABLE_ROW -> {
                requireNonEmpty(children, "table rows must contain cells");
                validateChildrenAs(children, Set.of(TABLE_CELL, TABLE_HEADER), depth, counters);
            }
            case TABLE_CELL, TABLE_HEADER -> {
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
            if (++counters.marks > MAX_DOCUMENT_NODES)
                invalid("content exceeds the maximum mark count");
            Map<String, Object> mark = asStringMap(item, "text marks must be objects");
            String type = string(mark.get(TYPE), "text mark type must be a string");
            if (!Set.of("bold", "italic", "code", "link").contains(type))
                invalid("unsupported content mark type");
            Set<String> allowed = "link".equals(type) ? Set.of(TYPE, ATTRS) : Set.of(TYPE);
            if (!allowed.containsAll(mark.keySet()))
                invalid("content mark has unsupported properties");
            if ("link".equals(type)) validateLinkAttrs(mark.get(ATTRS));
        }
    }

    private static void validateAttrs(Object value, String type) {
        Map<String, Object> attrs = asStringMap(value, "node attributes must be an object");
        Set<String> allowed =
                switch (type) {
                    case HEADING -> Set.of("level");
                    case ORDERED_LIST -> Set.of(ORDERED_LIST_START, TYPE);
                    case CODE_BLOCK -> Set.of("language");
                    case TABLE_CELL, TABLE_HEADER ->
                            Set.of("colspan", "rowspan", COLWIDTH, "align");
                    case PARAGRAPH,
                            BULLET_LIST,
                            LIST_ITEM,
                            BLOCKQUOTE,
                            TABLE,
                            TABLE_ROW,
                            HARD_BREAK,
                            HORIZONTAL_RULE ->
                            Set.of();
                    default -> throw invalidException("unsupported content node attributes");
                };
        if (!allowed.containsAll(attrs.keySet())) invalid("node attributes are not supported");
        validateAttrValues(attrs, type);
    }

    private static void validateAttrValues(Map<String, Object> attrs, String type) {
        switch (type) {
            case HEADING -> {
                Object level = attrs.get("level");
                if (!(level instanceof Number number)
                        || number.intValue() < 1
                        || number.intValue() > 3
                        || number.doubleValue() != number.intValue())
                    invalid("heading level must be between 1 and 3");
            }
            case ORDERED_LIST -> {
                if (attrs.containsKey(ORDERED_LIST_START)
                        && !positiveInteger(attrs.get(ORDERED_LIST_START)))
                    invalid("ordered list start must be a positive integer");
                Object listType = attrs.get(TYPE);
                if (listType != null
                        && (!(listType instanceof String)
                                || !Set.of("1", "a", "A", "i", "I").contains(listType)))
                    invalid("ordered list type is invalid");
            }
            case CODE_BLOCK -> {
                Object language = attrs.get("language");
                if (language != null
                        && (!(language instanceof String) || ((String) language).length() > 100))
                    invalid("code block language is invalid");
            }
            case TABLE_CELL, TABLE_HEADER -> validateCellAttrs(attrs);
            default -> {
                // These supported node types have no additional attribute value constraints.
            }
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
        if (attrs.containsKey(COLWIDTH) && attrs.get(COLWIDTH) != null) {
            for (Object width : asList(attrs.get(COLWIDTH), "table colwidth must be an array"))
                if (!nonNegativeBoundedInteger(width, 10_000))
                    invalid("table column width is invalid");
        }
    }

    private static void validateLinkAttrs(Object value) {
        Map<String, Object> attrs = asStringMap(value, "link attributes must be an object");
        if (!Set.of("href", "target", "rel", CLASS, "title").containsAll(attrs.keySet())
                || !attrs.containsKey("href")) invalid("link attributes are invalid");
        String href = string(attrs.get("href"), "link href must be a string");
        if (!isSafeHref(href)) invalid("link href must use an absolute http, https, or mailto URL");
        Object target = attrs.get("target");
        if (target != null && !"_blank".equals(target)) invalid("link target is invalid");
        Object rel = attrs.get("rel");
        if (rel != null && !isSafeRel(rel)) invalid("link rel is invalid");
        if (attrs.containsKey(CLASS) && attrs.get(CLASS) != null)
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

    static long serializedJsonSize(Object root) {
        long bytes = 0;
        int values = 0;
        Deque<Object> pending = new ArrayDeque<>();
        pending.push(root);
        while (!pending.isEmpty()) {
            Object value = pending.pop();
            if (++values > MAX_DOCUMENT_NODES * 10)
                invalid("content contains too many JSON values");
            bytes += jsonValueSize(value, pending);
            if (bytes > MAX_SERIALIZED_BYTES) return bytes;
        }
        return bytes;
    }

    private static long jsonValueSize(Object value, Deque<Object> pending) {
        if (value == JsonNull.INSTANCE) return 4;
        if (value instanceof String text) return quotedStringSize(text);
        if (value instanceof Boolean bool) return bool ? 4 : 5;
        if (value instanceof Number number) return jsonNumberSize(number);
        if (value instanceof Map<?, ?> map) return jsonObjectSize(map, pending);
        if (value instanceof List<?> list) return jsonArraySize(list, pending);
        throw invalidException("content contains a non-JSON value");
    }

    private static long jsonNumberSize(Number number) {
        if ((number instanceof Double d && !Double.isFinite(d))
                || (number instanceof Float f && !Float.isFinite(f)))
            throw invalidException("content contains a non-JSON number");
        return number.toString().getBytes(StandardCharsets.UTF_8).length;
    }

    private static long jsonObjectSize(Map<?, ?> map, Deque<Object> pending) {
        if (map.size() > MAX_DOCUMENT_NODES) invalid("content contains too many JSON properties");
        long bytes = 2L + Math.max(0, map.size() - 1);
        for (Map.Entry<?, ?> entry : map.entrySet()) {
            if (!(entry.getKey() instanceof String)) invalid("content object keys must be strings");
            bytes += quotedStringSize((String) entry.getKey()) + 1;
            pending.push(entry.getValue() == null ? JsonNull.INSTANCE : entry.getValue());
        }
        return bytes;
    }

    private static long jsonArraySize(List<?> list, Deque<Object> pending) {
        if (list.size() > MAX_DOCUMENT_NODES)
            invalid("content contains too many JSON array values");
        for (Object item : list) pending.push(item == null ? JsonNull.INSTANCE : item);
        return 2L + Math.max(0, list.size() - 1);
    }

    private static long quotedStringSize(String value) {
        long bytes = 2;
        for (int offset = 0; offset < value.length(); ) {
            int codePoint = value.codePointAt(offset);
            offset += Character.charCount(codePoint);
            bytes += quotedCodePointSize(codePoint);
        }
        return bytes;
    }

    private static int quotedCodePointSize(int codePoint) {
        if (codePoint == '"'
                || codePoint == '\\'
                || codePoint == '\b'
                || codePoint == '\f'
                || codePoint == '\n'
                || codePoint == '\r'
                || codePoint == '\t') return 2;
        if (codePoint < 0x20
                || (codePoint >= Character.MIN_SURROGATE && codePoint <= Character.MAX_SURROGATE))
            return 6;
        return utf8CodePointSize(codePoint);
    }

    private static int utf8CodePointSize(int codePoint) {
        if (codePoint <= 0x7f) return 1;
        if (codePoint <= 0x7ff) return 2;
        if (codePoint <= 0xffff) return 3;
        return 4;
    }

    private static String nodeType(Object value) {
        return string(
                asStringMap(value, CONTENT_NODES_MUST_BE_OBJECTS).get(TYPE),
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

    private static boolean nonNegativeBoundedInteger(Object value, int maximum) {
        if (!(value instanceof Number number)) return false;
        double numericValue = number.doubleValue();
        return Double.isFinite(numericValue)
                && numericValue >= 0
                && numericValue <= maximum
                && numericValue == Math.rint(numericValue);
    }

    private static boolean positiveBoundedInteger(Object value) {
        return positiveInteger(value) && ((Number) value).intValue() <= 100;
    }

    private static void requireNonEmpty(List<?> values, String message) {
        if (values.isEmpty()) invalid(message);
    }

    static boolean isWhitespace(int codePoint) {
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
        return new InvalidNoteException(CONTENT, message);
    }

    private static final class Counters {
        private int nodes;
        private int marks;
    }

    private enum JsonNull {
        INSTANCE
    }
}
