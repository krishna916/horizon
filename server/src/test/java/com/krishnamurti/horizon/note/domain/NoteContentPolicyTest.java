package com.krishnamurti.horizon.note.domain;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

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
        assertInvalid(doc(node("tableCell", Map.of("colspan", 101), List.of(paragraph()))));
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
    void acceptsOneMibSerializedContentAndRejectsLargerDocuments() {
        int overhead = serializedSize();
        String boundaryText = "x".repeat(1_048_576 - overhead);
        assertThat(NoteContentPolicy.validateAndCopy(doc(paragraph(text(boundaryText)))))
                .isNotNull();
        assertInvalid(doc(paragraph(text(boundaryText + "x"))));
        String unicodeBoundary = "x".repeat(1_048_576 - overhead - 2) + "é";
        assertThat(NoteContentPolicy.validateAndCopy(doc(paragraph(text(unicodeBoundary)))))
                .isNotNull();
    }

    @Test
    void rejectsExcessiveNodeCountAndNestingAndReturnsDefensiveCopy() {
        List<Map<String, Object>> manyNodes = new ArrayList<>();
        for (int index = 0; index < 10_001; index++) {
            manyNodes.add(node("horizontalRule"));
        }
        assertInvalid(doc(manyNodes));

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
