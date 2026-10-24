package com.krishnamurti.horizon.task.domain;

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

/** Validates and normalizes the supported Tiptap JSON schema for a Task description. */
public final class TaskDescriptionValidator {

    public static final int MAX_SERIALIZED_BYTES = 256 * 1024;
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
    private static final Set<String> SAFE_REL_TOKENS = Set.of("noopener", "noreferrer", "nofollow");
    private static final Pattern REL_TOKEN_SEPARATOR = Pattern.compile("\\s+");

    private TaskDescriptionValidator() {}

    /** Returns a normalized defensive copy, or null when the document contains no content. */
    public static Map<String, Object> validateAndCopy(Map<String, Object> input) {
        if (input == null) {
            return null;
        }
        if (serializedJsonSize(input) > MAX_SERIALIZED_BYTES) {
            invalid("description exceeds the maximum serialized size");
        }

        Counters counters = new Counters();
        validateNode(input, "doc", 1, counters);
        if (isSemanticallyEmpty(input)) {
            return null;
        }
        return copyMap(input);
    }

    private static void validateNode(
            Object value, String expectedType, int depth, Counters counters) {
        if (depth > MAX_NESTING_DEPTH) {
            invalid("description exceeds the maximum nesting depth");
        }
        counters.nodes++;
        if (counters.nodes > MAX_DOCUMENT_NODES) {
            invalid("description exceeds the maximum node count");
        }
        Map<String, Object> node = asStringMap(value, "description nodes must be objects");
        String type = string(node.get("type"), "description node type must be a string");
        if (!expectedType.equals(type)) {
            invalid("invalid " + expectedType + " child node");
        }
        validateNodeKeys(node, type);
        if (node.containsKey("attrs")) {
            validateAttrs(node.get("attrs"), type);
        }

        if (type.equals("text")) {
            string(node.get("text"), "text node content must be a string");
            if (node.containsKey("marks")) {
                validateMarks(node.get("marks"), counters);
            }
            return;
        }
        if (type.equals("hardBreak") || type.equals("horizontalRule")) {
            if (node.containsKey("content")
                    && !asList(node.get("content"), "leaf node content must be an array")
                            .isEmpty()) {
                invalid("leaf nodes cannot contain child nodes");
            }
            return;
        }

        List<?> content =
                node.containsKey("content")
                        ? asList(node.get("content"), "node content must be an array")
                        : List.of();
        validateChildren(type, content, depth, counters);
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
                    default -> throw invalidException("unsupported description node type");
                };
        if (!allowed.containsAll(node.keySet())) {
            invalid("description node has unsupported properties");
        }
        if (type.equals("doc") && !node.containsKey("content")) {
            invalid("description document content must be an array");
        }
    }

    private static void validateChildren(
            String type, List<?> content, int depth, Counters counters) {
        if (type.equals("doc")) {
            validateChildrenAs(content, BLOCKS, depth, counters);
            return;
        }
        if (type.equals("paragraph") || type.equals("heading")) {
            validateChildrenAs(content, INLINE, depth, counters);
            return;
        }
        if (type.equals("bulletList") || type.equals("orderedList")) {
            requireNonEmpty(content, "lists must contain a list item");
            validateChildrenAs(content, Set.of("listItem"), depth, counters);
            return;
        }
        if (type.equals("listItem")) {
            requireNonEmpty(content, "list items must contain a paragraph");
            if (!"paragraph".equals(nodeType(content.getFirst()))) {
                invalid("list items must start with a paragraph");
            }
            validateChildrenAs(content, BLOCKS, depth, counters);
            return;
        }
        if (type.equals("blockquote")) {
            requireNonEmpty(content, "block quotes must contain block content");
            validateChildrenAs(content, BLOCKS, depth, counters);
            return;
        }
        if (type.equals("codeBlock")) {
            validateChildrenAs(content, Set.of("text"), depth, counters);
            return;
        }
        if (type.equals("table")) {
            requireNonEmpty(content, "tables must contain a row");
            validateChildrenAs(content, Set.of("tableRow"), depth, counters);
            return;
        }
        if (type.equals("tableRow")) {
            requireNonEmpty(content, "table rows must contain cells");
            validateChildrenAs(content, Set.of("tableCell", "tableHeader"), depth, counters);
            return;
        }
        if (type.equals("tableCell") || type.equals("tableHeader")) {
            requireNonEmpty(content, "table cells must contain block content");
            validateChildrenAs(content, BLOCKS, depth, counters);
        }
    }

    private static void validateChildrenAs(
            List<?> children, Set<String> allowedTypes, int depth, Counters counters) {
        for (Object child : children) {
            String childType = nodeType(child);
            if (!allowedTypes.contains(childType)) {
                invalid("invalid child placement in description");
            }
            validateNode(child, childType, depth + 1, counters);
        }
    }

    private static void validateMarks(Object value, Counters counters) {
        List<?> marks = asList(value, "text marks must be an array");
        for (Object item : marks) {
            counters.nodes++;
            if (counters.nodes > MAX_DOCUMENT_NODES) {
                invalid("description exceeds the maximum node count");
            }
            Map<String, Object> mark = asStringMap(item, "text marks must be objects");
            String type = string(mark.get("type"), "text mark type must be a string");
            if (!(type.equals("bold")
                    || type.equals("italic")
                    || type.equals("code")
                    || type.equals("link"))) {
                invalid("unsupported description mark type");
            }
            Set<String> allowed = type.equals("link") ? Set.of("type", "attrs") : Set.of("type");
            if (!allowed.containsAll(mark.keySet())) {
                invalid("description mark has unsupported properties");
            }
            if (type.equals("link")) {
                validateLinkAttrs(mark.get("attrs"));
            }
        }
    }

    private static void validateAttrs(Object value, String type) {
        if (value == null) {
            invalid("node attributes must be an object");
        }
        Map<String, Object> attrs = asStringMap(value, "node attributes must be an object");
        Set<String> allowed =
                switch (type) {
                    case "heading" -> Set.of("level");
                    case "orderedList" -> Set.of("start", "type");
                    case "codeBlock" -> Set.of("language");
                    case "tableCell", "tableHeader" -> Set.of("colspan", "rowspan", "colwidth");
                    case "paragraph",
                            "bulletList",
                            "listItem",
                            "blockquote",
                            "table",
                            "tableRow",
                            "hardBreak",
                            "horizontalRule" ->
                            Set.of();
                    default -> throw invalidException("unsupported description node attributes");
                };
        if (!allowed.containsAll(attrs.keySet())) {
            invalid("description node has unsupported attributes");
        }
        switch (type) {
            case "heading" -> {
                Object level = attrs.get("level");
                if (!(level instanceof Number number)
                        || number.intValue() < 1
                        || number.intValue() > 3
                        || number.doubleValue() != number.intValue()) {
                    invalid("heading level must be between 1 and 3");
                }
            }
            case "orderedList" -> {
                if (attrs.containsKey("start") && !positiveInteger(attrs.get("start"))) {
                    invalid("ordered list start must be a positive integer");
                }
                Object listType = attrs.get("type");
                if (listType != null
                        && !(listType instanceof String orderedType
                                && Set.of("1", "a", "A", "i", "I").contains(orderedType))) {
                    invalid("ordered list type is invalid");
                }
            }
            case "codeBlock" -> {
                Object language = attrs.get("language");
                if (language != null
                        && (!(language instanceof String languageValue)
                                || languageValue.length() > 100)) {
                    invalid("code block language must be a short string or null");
                }
            }
            case "tableCell", "tableHeader" -> validateCellAttrs(attrs);
            default -> {}
        }
    }

    private static void validateCellAttrs(Map<String, Object> attrs) {
        if (attrs.containsKey("colspan") && !positiveBoundedInteger(attrs.get("colspan"))) {
            invalid("table colspan must be a positive integer");
        }
        if (attrs.containsKey("rowspan") && !positiveBoundedInteger(attrs.get("rowspan"))) {
            invalid("table rowspan must be a positive integer");
        }
        if (attrs.containsKey("colwidth") && attrs.get("colwidth") != null) {
            List<?> widths =
                    asList(attrs.get("colwidth"), "table colwidth must be an array or null");
            for (Object width : widths) {
                if (!positiveBoundedInteger(width)) {
                    invalid("table column widths must be positive integers");
                }
            }
        }
    }

    private static void validateLinkAttrs(Object value) {
        Map<String, Object> attrs = asStringMap(value, "link attributes must be an object");
        if (!Set.of("href", "target", "rel", "class").containsAll(attrs.keySet())
                || !attrs.containsKey("href")) {
            invalid("link attributes are invalid");
        }
        String href = string(attrs.get("href"), "link href must be a string");
        if (!isSafeHref(href)) {
            invalid("link href must use an absolute http, https, or mailto URL");
        }
        Object target = attrs.get("target");
        if (target != null && !"_blank".equals(target) && !"_self".equals(target)) {
            invalid("link target is invalid");
        }
        Object rel = attrs.get("rel");
        if (rel != null && !isSafeRel(rel)) {
            invalid("link rel is invalid");
        }
        if (attrs.containsKey("class") && attrs.get("class") != null) {
            invalid("link class must be null");
        }
    }

    private static boolean isSafeHref(String value) {
        if (value.isBlank() || value.codePoints().anyMatch(Character::isISOControl)) {
            return false;
        }
        try {
            URI uri = new URI(value);
            String scheme = uri.getScheme();
            if (!uri.isAbsolute() || scheme == null) {
                return false;
            }
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
        if (!(value instanceof String rel) || rel.isBlank()) {
            return false;
        }
        return REL_TOKEN_SEPARATOR
                .splitAsStream(rel)
                .filter(token -> !token.isEmpty())
                .allMatch(SAFE_REL_TOKENS::contains);
    }

    private static boolean isSemanticallyEmpty(Map<String, Object> document) {
        Deque<Object> pending = new ArrayDeque<>();
        pending.push(document);
        while (!pending.isEmpty()) {
            Map<String, Object> node =
                    asStringMap(pending.pop(), "description nodes must be objects");
            String type = (String) node.get("type");
            if (type.equals("table") || type.equals("horizontalRule")) {
                return false;
            }
            if (type.equals("text")) {
                String text = (String) node.get("text");
                if (!text.codePoints()
                        .allMatch(
                                codePoint ->
                                        Character.isWhitespace(codePoint)
                                                || Character.isSpaceChar(codePoint))) {
                    return false;
                }
            }
            Object content = node.get("content");
            if (content instanceof List<?> children) {
                for (Object child : children) pending.push(child);
            }
        }
        return true;
    }

    private static long serializedJsonSize(Object input) {
        long bytes = 0;
        int values = 0;
        Deque<Object> pending = new ArrayDeque<>();
        pending.push(input);
        while (!pending.isEmpty()) {
            Object value = pending.pop();
            if (++values > MAX_DOCUMENT_NODES * 10) {
                invalid("description contains too many JSON values");
            }
            if (value instanceof JsonNull) {
                bytes += 4;
            } else if (value instanceof String text) {
                bytes += quotedStringSize(text);
            } else if (value instanceof Boolean bool) {
                bytes += bool ? 4 : 5;
            } else if (value instanceof Number number) {
                String numeric = number.toString();
                if ((number instanceof Double doubleValue && !Double.isFinite(doubleValue))
                        || (number instanceof Float floatValue && !Float.isFinite(floatValue))) {
                    invalid("description contains a non-JSON number");
                }
                bytes += numeric.getBytes(StandardCharsets.UTF_8).length;
            } else if (value instanceof Map<?, ?> map) {
                if (map.size() > MAX_DOCUMENT_NODES)
                    invalid("description contains too many JSON properties");
                bytes += 2L + Math.max(0, map.size() - 1);
                for (Map.Entry<?, ?> entry : map.entrySet()) {
                    if (!(entry.getKey() instanceof String))
                        invalid("description object keys must be strings");
                    bytes += quotedStringSize((String) entry.getKey()) + 1;
                    pending.push(entry.getValue() == null ? JsonNull.INSTANCE : entry.getValue());
                }
            } else if (value instanceof List<?> list) {
                if (list.size() > MAX_DOCUMENT_NODES)
                    invalid("description contains too many JSON array values");
                bytes += 2L + Math.max(0, list.size() - 1);
                for (Object item : list) pending.push(item == null ? JsonNull.INSTANCE : item);
            } else {
                invalid("description contains a non-JSON value");
            }
            if (bytes > MAX_SERIALIZED_BYTES) {
                return bytes;
            }
        }
        return bytes;
    }

    private static long quotedStringSize(String value) {
        long bytes = 2;
        for (int offset = 0; offset < value.length(); ) {
            int codePoint = value.codePointAt(offset);
            offset += Character.charCount(codePoint);
            if (codePoint == '"' || codePoint == '\\') {
                bytes += 2;
            } else if (codePoint < 0x20) {
                bytes += 6;
            } else {
                bytes +=
                        new String(Character.toChars(codePoint))
                                .getBytes(StandardCharsets.UTF_8)
                                .length;
            }
        }
        return bytes;
    }

    private static String nodeType(Object value) {
        return string(
                asStringMap(value, "description nodes must be objects").get("type"),
                "description node type must be a string");
    }

    private static Map<String, Object> asStringMap(Object value, String message) {
        if (!(value instanceof Map<?, ?>)) invalid(message);
        Map<String, Object> result = new LinkedHashMap<>();
        for (Map.Entry<?, ?> entry : ((Map<?, ?>) value).entrySet()) {
            if (!(entry.getKey() instanceof String))
                invalid("description object keys must be strings");
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

    private static Map<String, Object> copyMap(Map<String, Object> value) {
        Map<String, Object> copy = new LinkedHashMap<>();
        value.forEach((key, nested) -> copy.put(key, copyValue(nested)));
        return copy;
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

    private static InvalidTaskException invalidException(String message) {
        return new InvalidTaskException("description", message);
    }

    private static final class Counters {
        private int nodes;
    }

    private enum JsonNull {
        INSTANCE
    }
}
