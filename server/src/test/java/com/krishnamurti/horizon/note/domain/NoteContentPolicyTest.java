package com.krishnamurti.horizon.note.domain;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.ObjectMapper;

class NoteContentPolicyTest {

    @Test
    void emptyAndWhitespaceDocumentsNormalizeToNull() {
        assertThat(NoteContentPolicy.validateAndCopy(null)).isNull();
        assertThat(NoteContentPolicy.validateAndCopy(doc())).isNull();
        assertThat(NoteContentPolicy.validateAndCopy(doc(paragraph()))).isNull();
        assertThat(NoteContentPolicy.validateAndCopy(doc(paragraph(text(" \t\n"))))).isNull();
        assertThat(NoteContentPolicy.validateAndCopy(doc(paragraph(text("  ", bold()))))).isNull();
        assertThat(NoteContentPolicy.validateAndCopy(doc(paragraph(text("styled", bold())))))
                .isNotNull();
    }

    @Test
    void textTableAndHorizontalRuleAreMeaningful() {
        assertThat(NoteContentPolicy.hasMeaningfulContent(doc(paragraph(text("body"))))).isTrue();
        assertThat(NoteContentPolicy.hasMeaningfulContent(doc(table()))).isTrue();
        assertThat(NoteContentPolicy.hasMeaningfulContent(doc(emptyTable()))).isTrue();
        assertThat(NoteContentPolicy.hasMeaningfulContent(doc(node("horizontalRule")))).isTrue();
        assertThat(NoteContentPolicy.hasMeaningfulContent(doc(paragraph(text("   "))))).isFalse();
    }

    @Test
    void acceptsSupportedTiptapNodesMarksAndSafeUrls() {
        Map<String, Object> link =
                Map.of(
                        "type",
                        "link",
                        "attrs",
                        Map.of(
                                "href",
                                "https://example.com/docs",
                                "target",
                                "_blank",
                                "rel",
                                "noopener noreferrer"));
        Map<String, Object> document =
                doc(
                        node("heading", Map.of("level", 2), List.of(text("heading"))),
                        paragraph(text("plain", bold(), italic(), code(), link)),
                        node("bulletList", List.of(listItem(paragraph(text("list"))))),
                        node("codeBlock", List.of(text("code"))),
                        node("blockquote", List.of(paragraph(text("quote")))),
                        table(),
                        node("horizontalRule"));

        assertThat(NoteContentPolicy.validateAndCopy(document)).isEqualTo(document);
        assertThat(
                        NoteContentPolicy.validateAndCopy(
                                doc(paragraph(text("mail", link("mailto:notes@example.com"))))))
                .isNotNull();
    }

    @Test
    void rejectsUnknownNodesRawHtmlAndUnsafeLinks() {
        assertInvalid(doc(node("image")));
        assertInvalid(doc(node("paragraph", Map.of("html", "<script>bad</script>"), List.of())));
        assertInvalid(doc(paragraph(text("unsafe", link("javascript:alert(1)")))));
        assertInvalid(
                doc(paragraph(text("extra", Map.of("type", "text", "text", "bad", "id", "x")))));
    }

    @Test
    void validatesAttributesMarksAndSerializedJsonValues() {
        assertThat(
                        NoteContentPolicy.validateAndCopy(
                                doc(
                                        node("heading", Map.of("level", 3), List.of(text("h"))),
                                        node(
                                                "orderedList",
                                                Map.of("start", 2, "type", "i"),
                                                List.of(listItem(paragraph(text("item"))))),
                                        node(
                                                "codeBlock",
                                                Map.of("language", "java"),
                                                List.of(text("code"))),
                                        node(
                                                "table",
                                                List.of(
                                                        node(
                                                                "tableRow",
                                                                List.of(
                                                                        node(
                                                                                "tableHeader",
                                                                                Map.of(
                                                                                        "colspan",
                                                                                        2,
                                                                                        "rowspan",
                                                                                        1,
                                                                                        "colwidth",
                                                                                        List.of(10),
                                                                                        "align",
                                                                                        "center"),
                                                                                List.of(
                                                                                        paragraph(
                                                                                                text(
                                                                                                        "head")))))))))))
                .isNotNull();

        assertInvalid(doc(node("heading", Map.of("level", 4), List.of(paragraph()))));
        assertInvalid(doc(node("orderedList", Map.of("start", 0), List.of(listItem(paragraph())))));
        assertInvalid(doc(node("codeBlock", Map.of("language", "x".repeat(101)), List.of())));
        assertInvalidWithMessage(
                doc(
                        node(
                                "table",
                                List.of(
                                        node(
                                                "tableRow",
                                                List.of(
                                                        node(
                                                                "tableCell",
                                                                Map.of("colspan", 101),
                                                                List.of(paragraph()))))))),
                "table cell span is invalid");
        assertInvalid(
                doc(
                        paragraph(
                                text(
                                        "bad",
                                        Map.of(
                                                "type",
                                                "link",
                                                "attrs",
                                                Map.of("href", "https://user@example.com"))))));
        assertInvalid(
                doc(
                        paragraph(
                                text(
                                        "bad",
                                        Map.of(
                                                "type",
                                                "link",
                                                "attrs",
                                                Map.of(
                                                        "href",
                                                        "https://example.com",
                                                        "rel",
                                                        "noopener"))))));
        assertInvalid(
                doc(
                        paragraph(
                                Map.of(
                                        "type",
                                        "text",
                                        "text",
                                        "x",
                                        "marks",
                                        List.of(Map.of("type", "bold", "extra", true))))));
        assertInvalid(
                doc(
                        paragraph(text("x")),
                        Map.of("type", "horizontalRule", "attrs", Map.of("extra", true))));
        assertInvalid(
                Map.of("type", "doc", "content", List.of(Map.of("type", "text", "text", "x"))));
        assertInvalid(
                doc(
                        paragraph(
                                Map.of(
                                        "type",
                                        "text",
                                        "text",
                                        "x",
                                        "marks",
                                        List.of(Map.of("type", "link"))))));
        assertInvalid(
                doc(
                        paragraph(
                                Map.of(
                                        "type",
                                        "text",
                                        "text",
                                        "x",
                                        "marks",
                                        List.of(
                                                Map.of(
                                                        "type",
                                                        "link",
                                                        "attrs",
                                                        Map.of("href", "mailto://bad")))))));
        assertInvalid(
                doc(
                        paragraph(
                                Map.of(
                                        "type",
                                        "text",
                                        "text",
                                        "x",
                                        "marks",
                                        List.of(
                                                Map.of(
                                                        "type",
                                                        "link",
                                                        "attrs",
                                                        Map.of(
                                                                "href",
                                                                "https://example.com",
                                                                "target",
                                                                "_self")))))));
        assertInvalid(
                doc(
                        paragraph(
                                Map.of(
                                        "type",
                                        "text",
                                        "text",
                                        "x",
                                        "marks",
                                        List.of(
                                                Map.of(
                                                        "type",
                                                        "link",
                                                        "attrs",
                                                        Map.of(
                                                                "href",
                                                                "https://example.com",
                                                                "class",
                                                                "unsafe")))))));
        assertInvalid(
                doc(
                        paragraph(
                                Map.of(
                                        "type",
                                        "text",
                                        "text",
                                        "x",
                                        "marks",
                                        List.of(Map.of("type", "unknown"))))));
    }

    @Test
    void acceptsPixelWidthsAndZeroForUnspecifiedSpannedColumns() {
        Map<String, Object> document =
                doc(
                        node(
                                "table",
                                List.of(
                                        node(
                                                "tableRow",
                                                List.of(
                                                        node(
                                                                "tableCell",
                                                                Map.of(
                                                                        "colspan",
                                                                        2,
                                                                        "colwidth",
                                                                        List.of(0, 160)),
                                                                List.of(paragraph(text("wide")))),
                                                        node(
                                                                "tableCell",
                                                                Map.of("colwidth", List.of(160)),
                                                                List.of(paragraph(text("normal")))),
                                                        node(
                                                                "tableCell",
                                                                Map.of("colwidth", List.of(10_000)),
                                                                List.of(
                                                                        paragraph(
                                                                                text(
                                                                                        "maximum")))))))));

        assertThat(NoteContentPolicy.validateAndCopy(document)).isEqualTo(document);
    }

    @Test
    void rejectsInvalidColumnPixelWidthsWithoutRelaxingCellSpanBounds() {
        assertInvalidWithMessage(tableCellWithColumnWidths(-1), "table column width is invalid");
        assertInvalidWithMessage(
                tableCellWithColumnWidths(10_001), "table column width is invalid");
        assertInvalidWithMessage(tableCellWithColumnWidths(1.5), "table column width is invalid");
        assertInvalidWithMessage(tableCellWithColspan(101), "table cell span is invalid");
    }

    @Test
    void acceptsOneMibSerializedContentAndRejectsLargerDocuments() {
        int overhead = serializedSize();
        String boundaryText = "x".repeat(1_048_576 - overhead);
        assertThat(NoteContentPolicy.validateAndCopy(doc(paragraph(text(boundaryText)))))
                .isNotNull();
        assertInvalid(doc(paragraph(text(boundaryText + "x"))));
        String unicodeBoundary = "x".repeat(1_048_576 - overhead - 2) + "é";
        assertThat(NoteContentPolicy.validateAndCopy(doc(paragraph(text(unicodeBoundary)))))
                .isNotNull();

        String escapedBoundaryText = "\n".repeat((1_048_576 - overhead - 1) / 2) + "x";
        assertThat(NoteContentPolicy.serializedJsonSize(doc(paragraph(text(escapedBoundaryText)))))
                .isEqualTo(1_048_576);
        assertThat(NoteContentPolicy.validateAndCopy(doc(paragraph(text(escapedBoundaryText)))))
                .isNotNull();
        assertInvalidWithMessage(
                doc(paragraph(text("\n" + escapedBoundaryText))),
                "content exceeds the maximum serialized size");
    }

    @Test
    void jsonByteAccountingMatchesJacksonThreeForEscapesUnicodeAndPropertyNames() throws Exception {
        Map<String, Object> value =
                Map.of(
                        "line\nkey\té😀",
                        List.of("\b\f\n\r\t\"\\\u0000\u0001\u001f", "ASCII é 😀", "\uD800"),
                        "nul\u0000",
                        Map.of("quote\"slash\\", "x"));
        byte[] serialized = new ObjectMapper().writeValueAsBytes(value);

        assertThat(NoteContentPolicy.serializedJsonSize(value)).isEqualTo(serialized.length);
    }

    @Test
    void countsAggregateDocumentNodesSeparatelyFromMarksAndReturnsDefensiveCopy() {
        List<Map<String, Object>> atLimit = new ArrayList<>();
        for (int index = 0; index < 4_999; index++) atLimit.add(paragraph(text("x")));
        assertThat(NoteContentPolicy.validateAndCopy(doc(atLimit))).isNotNull();

        atLimit.add(paragraph(text("x")));
        assertInvalidWithMessage(doc(atLimit), "content exceeds the maximum node count");

        List<Map<String, Object>> markedBlocks = new ArrayList<>();
        Map<String, Object>[] threeMarks = new Map[] {bold(), bold(), bold()};
        for (int index = 0; index < 3_334; index++)
            markedBlocks.add(paragraph(text("x", threeMarks)));
        assertInvalidWithMessage(doc(markedBlocks), "content exceeds the maximum mark count");

        Map<String, Object> deep = paragraph(text("bottom"));
        for (int index = 0; index < 33; index++) {
            deep = node("blockquote", List.of(deep));
        }
        assertInvalid(doc(deep));

        Map<String, Object> sourceText = text("original");
        Map<String, Object> copied = NoteContentPolicy.validateAndCopy(doc(paragraph(sourceText)));
        sourceText.put("text", "changed");
        assertThat(copied).isEqualTo(doc(paragraph(text("original"))));
    }

    private static void assertInvalid(Map<String, Object> document) {
        assertThatThrownBy(() -> NoteContentPolicy.validateAndCopy(document))
                .isInstanceOf(InvalidNoteException.class);
    }

    private static void assertInvalidWithMessage(Map<String, Object> document, String message) {
        assertThatThrownBy(() -> NoteContentPolicy.validateAndCopy(document))
                .isInstanceOf(InvalidNoteException.class)
                .hasMessageContaining(message);
    }

    private static Map<String, Object> tableCellWithColumnWidths(Number width) {
        return doc(
                node(
                        "table",
                        List.of(
                                node(
                                        "tableRow",
                                        List.of(
                                                node(
                                                        "tableCell",
                                                        Map.of("colwidth", List.of(width)),
                                                        List.of(paragraph(text("cell")))))))));
    }

    private static Map<String, Object> tableCellWithColspan(int colspan) {
        return doc(
                node(
                        "table",
                        List.of(
                                node(
                                        "tableRow",
                                        List.of(
                                                node(
                                                        "tableCell",
                                                        Map.of("colspan", colspan),
                                                        List.of(paragraph(text("cell")))))))));
    }

    private static int serializedSize() {
        return 85;
    }

    private static Map<String, Object> doc(Map<String, Object>... blocks) {
        return doc(List.of(blocks));
    }

    private static Map<String, Object> doc(List<Map<String, Object>> blocks) {
        return Map.of("type", "doc", "content", blocks);
    }

    private static Map<String, Object> paragraph(Map<String, Object>... children) {
        return node("paragraph", List.of(children));
    }

    private static Map<String, Object> text(String value, Map<String, Object>... marks) {
        Map<String, Object> node = new java.util.LinkedHashMap<>();
        node.put("type", "text");
        node.put("text", value);
        if (marks.length > 0) {
            node.put("marks", List.of(marks));
        }
        return node;
    }

    private static Map<String, Object> bold() {
        return Map.of("type", "bold");
    }

    private static Map<String, Object> italic() {
        return Map.of("type", "italic");
    }

    private static Map<String, Object> code() {
        return Map.of("type", "code");
    }

    private static Map<String, Object> link(String href) {
        return Map.of("type", "link", "attrs", Map.of("href", href));
    }

    private static Map<String, Object> listItem(Map<String, Object>... children) {
        return node("listItem", List.of(children));
    }

    private static Map<String, Object> table() {
        return node(
                "table",
                List.of(
                        node(
                                "tableRow",
                                List.of(node("tableCell", List.of(paragraph(text("cell"))))))));
    }

    private static Map<String, Object> emptyTable() {
        return node(
                "table",
                List.of(node("tableRow", List.of(node("tableCell", List.of(paragraph()))))));
    }

    private static Map<String, Object> node(String type) {
        return Map.of("type", type);
    }

    private static Map<String, Object> node(String type, List<Map<String, Object>> content) {
        return Map.of("type", type, "content", content);
    }

    private static Map<String, Object> node(
            String type, Map<String, Object> attrs, List<Map<String, Object>> content) {
        return Map.of("type", type, "attrs", attrs, "content", content);
    }
}
