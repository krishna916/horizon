package com.krishnamurti.horizon.task.domain;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;

class TaskDescriptionValidatorTest {

    @Test
    void nullAndLegacyParagraphsRemainCompatible() {
        assertThat(TaskDescriptionValidator.validateAndCopy(null)).isNull();
        Map<String, Object> legacy = doc(paragraph(text("Existing plain description", List.of())));

        assertThat(TaskDescriptionValidator.validateAndCopy(legacy)).isEqualTo(legacy);
    }

    @Test
    void emptyAndWhitespaceOnlyParagraphsNormalizeToNull() {
        assertThat(TaskDescriptionValidator.validateAndCopy(doc())).isNull();
        assertThat(TaskDescriptionValidator.validateAndCopy(doc(paragraph()))).isNull();
        assertThat(
                        TaskDescriptionValidator.validateAndCopy(
                                doc(paragraph(text(" \t\n", List.of())))))
                .isNull();
    }

    @Test
    void structuralEmptyTableAndHorizontalRuleArePreserved() {
        Map<String, Object> emptyTable =
                node(
                        "table",
                        Map.of(),
                        List.of(
                                node(
                                        "tableRow",
                                        Map.of(),
                                        List.of(
                                                node(
                                                        "tableCell",
                                                        cellAttrs(),
                                                        List.of(paragraph()))))));

        assertThat(TaskDescriptionValidator.validateAndCopy(doc(emptyTable)))
                .isEqualTo(doc(emptyTable));
        assertThat(TaskDescriptionValidator.validateAndCopy(doc(node("horizontalRule"))))
                .isEqualTo(doc(node("horizontalRule")));
    }

    @Test
    void acceptsAllSupportedTiptapNodesAndMarks() {
        Map<String, Object> linkMark =
                Map.of(
                        "type",
                        "link",
                        "attrs",
                        map(
                                "href",
                                "mailto:hello@example.com",
                                "target",
                                "_blank",
                                "rel",
                                "noopener noreferrer",
                                "class",
                                null,
                                "title",
                                null));
        Map<String, Object> table =
                node(
                        "table",
                        Map.of(),
                        List.of(
                                node(
                                        "tableRow",
                                        Map.of(),
                                        List.of(
                                                node(
                                                        "tableHeader",
                                                        cellAttrs(),
                                                        List.of(
                                                                paragraph(
                                                                        text("Head", List.of())))),
                                                node(
                                                        "tableCell",
                                                        cellAttrs(),
                                                        List.of(
                                                                paragraph(
                                                                        text(
                                                                                "Cell",
                                                                                List.of()))))))));
        Map<String, Object> document =
                doc(
                        node("heading", Map.of("level", 1), List.of(text("One", List.of()))),
                        node("heading", Map.of("level", 2), List.of(text("Two", List.of()))),
                        node("heading", Map.of("level", 3), List.of(text("Three", List.of()))),
                        paragraph(
                                text(
                                        "formatted",
                                        List.of(
                                                Map.of("type", "bold"),
                                                Map.of("type", "italic"),
                                                Map.of("type", "code"),
                                                linkMark))),
                        node(
                                "bulletList",
                                Map.of(),
                                List.of(
                                        node(
                                                "listItem",
                                                Map.of(),
                                                List.of(paragraph(text("Bullet", List.of())))))),
                        node(
                                "orderedList",
                                map("start", 1, "type", null),
                                List.of(
                                        node(
                                                "listItem",
                                                Map.of(),
                                                List.of(paragraph(text("Numbered", List.of())))))),
                        node("codeBlock", map("language", null), List.of(text("code", List.of()))),
                        node("blockquote", Map.of(), List.of(paragraph(text("Quote", List.of())))),
                        node("horizontalRule"),
                        table);

        assertThat(TaskDescriptionValidator.validateAndCopy(document)).isEqualTo(document);
    }

    @Test
    void rejectsOutboundLinkPolicyOverridesAndAcceptsCompatibleAttributes() {
        assertThat(
                        TaskDescriptionValidator.validateAndCopy(
                                linkDocument(map("href", "https://example.com"))))
                .isEqualTo(linkDocument(map("href", "https://example.com")));
        assertThat(
                        TaskDescriptionValidator.validateAndCopy(
                                linkDocument(
                                        map(
                                                "href",
                                                "https://example.com",
                                                "target",
                                                "_blank",
                                                "rel",
                                                "noopener noreferrer nofollow"))))
                .isNotNull();

        for (Map<String, Object> attrs :
                List.of(
                        map(
                                "href",
                                "https://example.com",
                                "target",
                                "_self",
                                "rel",
                                "noopener noreferrer"),
                        map("href", "https://example.com", "rel", "nofollow"),
                        map("href", "https://example.com", "rel", "noopener"))) {
            assertDescriptionInvalid(linkDocument(attrs));
        }
    }

    @Test
    void returnsDefensiveNestedCopy() {
        Map<String, Object> sourceText = text("Original", List.of());
        Map<String, Object> sourceParagraph = paragraph(sourceText);
        Map<String, Object> sourceDocument = doc(sourceParagraph);

        Map<String, Object> copy = TaskDescriptionValidator.validateAndCopy(sourceDocument);
        sourceText.put("text", "Changed");

        assertThat(copy).isNotSameAs(sourceDocument);
        assertThat(copy).isEqualTo(doc(paragraph(text("Original", List.of()))));
    }

    @Test
    void rejectsLinkTitlesLongerThan512Characters() {
        Map<String, Object> unsafeTitle =
                map(
                        "type",
                        "link",
                        "attrs",
                        map(
                                "href",
                                "https://example.com",
                                "target",
                                "_blank",
                                "rel",
                                "noopener noreferrer",
                                "class",
                                null,
                                "title",
                                "x".repeat(513)));
        assertDescriptionInvalid(doc(paragraph(text("docs", List.of(unsafeTitle)))));
    }

    @ParameterizedTest(name = "rejects invalid rich-text document: {0}")
    @MethodSource("invalidDocuments")
    void rejectsInvalidRichTextDocuments(String name, Map<String, Object> invalid) {
        assertDescriptionInvalid(invalid);
    }

    @Test
    void rejectsSerializedDocumentsLargerThan256KiB() {
        assertDescriptionInvalid(doc(paragraph(text("x".repeat(256 * 1024), List.of()))));
    }

    @Test
    void acceptsDocumentAtThe256KiBSerializedBoundary() {
        Map<String, Object> boundaryDocument =
                doc(
                        paragraph(
                                text(
                                        "x"
                                                .repeat(
                                                        TaskDescriptionValidator
                                                                        .MAX_SERIALIZED_BYTES
                                                                - 85),
                                        List.of())));

        assertThat(TaskDescriptionValidator.validateAndCopy(boundaryDocument))
                .isEqualTo(boundaryDocument);
    }

    @Test
    void rejectsDocumentsWithMoreThanTenThousandNodes() {
        List<Map<String, Object>> paragraphs = new ArrayList<>();
        for (int i = 0; i < 10_000; i++) {
            paragraphs.add(paragraph());
        }
        Map<String, Object> oversizedNodeDocument = new LinkedHashMap<>();
        oversizedNodeDocument.put("type", "doc");
        oversizedNodeDocument.put("content", paragraphs);
        assertDescriptionInvalid(oversizedNodeDocument);
    }

    @Test
    void rejectsDocumentsDeeperThanThirtyTwoNodes() {
        Map<String, Object> nested = paragraph(text("deep", List.of()));
        for (int i = 0; i < 32; i++) {
            nested = node("blockquote", Map.of(), List.of(nested));
        }
        assertDescriptionInvalid(doc(nested));
    }

    private static Stream<Arguments> invalidDocuments() {
        return Stream.of(
                Arguments.of("unknown node", doc(node("image"))),
                Arguments.of(
                        "unknown mark",
                        doc(paragraph(text("bad", List.of(Map.of("type", "strike")))))),
                Arguments.of(
                        "unknown node attribute",
                        doc(node("heading", Map.of("level", 2, "id", "x"), List.of()))),
                Arguments.of("null node attributes", doc(map("type", "paragraph", "attrs", null))),
                Arguments.of(
                        "null text marks",
                        doc(paragraph(map("type", "text", "text", "x", "marks", null)))),
                Arguments.of(
                        "script link protocol",
                        doc(paragraph(text("bad", List.of(link("javascript:alert(1)")))))),
                Arguments.of(
                        "relative link", doc(paragraph(text("bad", List.of(link("/relative")))))),
                Arguments.of("malformed tree placement", doc(text("not block", List.of()))),
                Arguments.of("non-string text", doc(paragraph(Map.of("type", "text", "text", 7)))),
                Arguments.of(
                        "invalid heading level",
                        doc(node("heading", Map.of("level", 4), List.of()))),
                Arguments.of(
                        "invalid table colspan",
                        tableCellDocument(
                                map("colspan", 0, "rowspan", 1, "colwidth", null, "align", null))),
                Arguments.of(
                        "invalid table alignment",
                        tableCellDocument(
                                map(
                                        "align",
                                        "url(javascript:alert(1))",
                                        "colspan",
                                        1,
                                        "rowspan",
                                        1,
                                        "colwidth",
                                        null))));
    }

    private static Map<String, Object> tableCellDocument(Map<String, Object> attrs) {
        return doc(
                node(
                        "table",
                        Map.of(),
                        List.of(
                                node(
                                        "tableRow",
                                        Map.of(),
                                        List.of(node("tableCell", attrs, List.of(paragraph())))))));
    }

    private static Map<String, Object> link(String href) {
        return Map.of(
                "type",
                "link",
                "attrs",
                map("href", href, "target", "_blank", "rel", "noopener noreferrer", "class", null));
    }

    private static Map<String, Object> linkDocument(Map<String, Object> attrs) {
        return doc(paragraph(text("documentation", List.of(map("type", "link", "attrs", attrs)))));
    }

    private static void assertDescriptionInvalid(Map<String, Object> document) {
        assertThatThrownBy(() -> TaskDescriptionValidator.validateAndCopy(document))
                .isInstanceOfSatisfying(
                        InvalidTaskException.class,
                        exception -> assertThat(exception.getField()).isEqualTo("description"));
    }

    @SafeVarargs
    private static Map<String, Object> doc(Map<String, Object>... content) {
        return node("doc", Map.of(), copyVarargs(content));
    }

    @SafeVarargs
    private static Map<String, Object> paragraph(Map<String, Object>... content) {
        return node("paragraph", Map.of(), copyVarargs(content));
    }

    private static List<Map<String, Object>> copyVarargs(Map<String, Object>[] values) {
        List<Map<String, Object>> copy = new ArrayList<>(values.length);
        for (Map<String, Object> value : values) copy.add(value);
        return copy;
    }

    private static Map<String, Object> text(String value, List<Map<String, Object>> marks) {
        Map<String, Object> node = new LinkedHashMap<>();
        node.put("type", "text");
        node.put("text", value);
        if (!marks.isEmpty()) node.put("marks", marks);
        return node;
    }

    private static Map<String, Object> node(String type) {
        return node(type, Map.of(), List.of());
    }

    private static Map<String, Object> node(
            String type, Map<String, Object> attrs, List<?> content) {
        Map<String, Object> node = new LinkedHashMap<>();
        node.put("type", type);
        if (!attrs.isEmpty()) node.put("attrs", attrs);
        if (!content.isEmpty() || SetOfTypes.ALWAYS_CONTENT.contains(type))
            node.put("content", content);
        return node;
    }

    private static Map<String, Object> cellAttrs() {
        return map("colspan", 1, "rowspan", 1, "colwidth", null, "align", null);
    }

    private static Map<String, Object> map(Object... values) {
        Map<String, Object> result = new LinkedHashMap<>();
        for (int i = 0; i < values.length; i += 2) result.put((String) values[i], values[i + 1]);
        return result;
    }

    private static final class SetOfTypes {
        private static final java.util.Set<String> ALWAYS_CONTENT = java.util.Set.of("doc");
    }
}
