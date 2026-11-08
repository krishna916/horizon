package com.krishnamurti.horizon.note.domain;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

class NotePreviewBuilderTest {

    private final NotePreviewBuilder builder = new NotePreviewBuilder();

    @Test
    void keepsDocumentOrderAndAtMostSixTopLevelBlocks() {
        Map<String, Object> document =
                document(List.of("one", "two", "three", "four", "five", "six", "seven"));

        Map<String, Object> preview = builder.build(document);

        assertThat(text(preview)).isEqualTo("onetwothreefourfivesix");
        assertThat(content(preview)).hasSize(6);
        assertThat(NoteContentPolicy.validateAndCopy(preview)).isEqualTo(preview);
    }

    @Test
    void truncatesAtFiveHundredTwentyGraphemeClusters() {
        String source = "a".repeat(519) + "👨‍👩‍👧‍👦" + "z";
        Map<String, Object> preview = builder.build(document(List.of(source)));

        String result = text(preview);

        assertThat(result).isEqualTo("a".repeat(519));
        assertThat(result.codePointCount(0, result.length())).isEqualTo(519);
    }

    @Test
    void enforcesSerializedByteBudgetAndHandlesEmptyContent() throws Exception {
        Map<String, Object> source =
                Map.of(
                        "type",
                        "doc",
                        "content",
                        List.of(
                                paragraphWithBreaks("first", 700),
                                paragraphWithBreaks("second", 700)));

        Map<String, Object> preview = builder.build(source);
        byte[] previewBytes = new ObjectMapper().writeValueAsBytes(preview);
        byte[] sourceBytes = new ObjectMapper().writeValueAsBytes(source);

        assertThat(preview).isNotNull();
        assertThat(previewBytes).hasSizeLessThanOrEqualTo(16 * 1024);
        assertThat(previewBytes.length).isLessThan(sourceBytes.length);
        assertThat(content(preview)).hasSizeLessThanOrEqualTo(6);
        assertThat(text(preview)).startsWith("first").contains("second");
        assertThat(NoteContentPolicy.validateAndCopy(preview)).isEqualTo(preview);

        Map<String, Object> oversizedFirstBlock =
                Map.of(
                        "type",
                        "doc",
                        "content",
                        List.of(
                                paragraphWithBreaks("lead", 1_500),
                                Map.of(
                                        "type",
                                        "paragraph",
                                        "content",
                                        List.of(
                                                Map.of(
                                                        "type",
                                                        "text",
                                                        "text",
                                                        "later-sentinel")))));
        Map<String, Object> truncated = builder.build(oversizedFirstBlock);

        assertThat(truncated).isNotNull();
        assertThat(text(truncated)).isEqualTo("lead");
        assertThat(content(truncated)).hasSize(1);
        assertThat(new ObjectMapper().writeValueAsBytes(truncated))
                .hasSizeLessThanOrEqualTo(16 * 1024);
        assertThat(NoteContentPolicy.validateAndCopy(truncated)).isEqualTo(truncated);
        assertThat(builder.build(null)).isNull();
        assertThat(builder.build(Map.of("type", "doc", "content", List.of()))).isNull();
    }

    @Test
    void copiesDenseBlockAsValidSerializedPrefixAndStopsBeforeLaterBlocks() throws Exception {
        Map<String, Object> source =
                Map.of(
                        "type",
                        "doc",
                        "content",
                        List.of(
                                paragraphWithBreaks("lead", 9_000),
                                Map.of(
                                        "type",
                                        "paragraph",
                                        "content",
                                        List.of(
                                                Map.of(
                                                        "type",
                                                        "text",
                                                        "text",
                                                        "later-sentinel")))));

        assertThat(NoteContentPolicy.validateAndCopy(source)).isEqualTo(source);

        Map<String, Object> preview = builder.build(source);

        assertThat(preview).isNotNull();
        assertThat(text(preview)).isEqualTo("lead");
        assertThat(content(preview)).hasSize(1);
        assertThat(children(content(preview).getFirst())).hasSizeBetween(1, 9_000);
        assertThat(children(content(preview).getFirst()).getFirst())
                .containsEntry("type", "text")
                .containsEntry("text", "lead");
        assertThat(children(content(preview).getFirst()).stream().skip(1))
                .allSatisfy(child -> assertThat(child).containsEntry("type", "hardBreak"));
        assertThat(new ObjectMapper().writeValueAsBytes(preview))
                .hasSizeLessThanOrEqualTo(16 * 1024);
        assertThat(NoteContentPolicy.validateAndCopy(preview)).isEqualTo(preview);
    }

    private static Map<String, Object> paragraphWithBreaks(String text, int breaks) {
        List<Map<String, Object>> children = new ArrayList<>();
        children.add(Map.of("type", "text", "text", text));
        for (int index = 0; index < breaks; index++) children.add(Map.of("type", "hardBreak"));
        return Map.of("type", "paragraph", "content", children);
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> children(Map<String, Object> node) {
        return (List<Map<String, Object>>) node.get("content");
    }

    @Test
    void keepsAValidShortNestedDocumentUnchanged() {
        Map<String, Object> source =
                Map.of(
                        "type",
                        "doc",
                        "content",
                        List.of(
                                Map.of(
                                        "type",
                                        "blockquote",
                                        "content",
                                        List.of(
                                                Map.of(
                                                        "type",
                                                        "paragraph",
                                                        "content",
                                                        List.of(
                                                                Map.of(
                                                                        "type", "text",
                                                                        "text", "linked",
                                                                        "marks",
                                                                                List.of(
                                                                                        Map.of(
                                                                                                "type",
                                                                                                "link",
                                                                                                "attrs",
                                                                                                Map
                                                                                                        .of(
                                                                                                                "href",
                                                                                                                "https://example.com"))))))))));

        assertThat(builder.build(source)).isEqualTo(source);
    }

    @Test
    void preservesNestedBlockQuoteListAndTableStructure() {
        Map<String, Object> source =
                Map.of(
                        "type",
                        "doc",
                        "content",
                        List.of(
                                Map.of(
                                        "type",
                                        "blockquote",
                                        "content",
                                        List.of(paragraph("quoted"))),
                                Map.of(
                                        "type",
                                        "bulletList",
                                        "content",
                                        List.of(
                                                Map.of(
                                                        "type",
                                                        "listItem",
                                                        "content",
                                                        List.of(paragraph("listed"))))),
                                Map.of(
                                        "type",
                                        "table",
                                        "content",
                                        List.of(
                                                Map.of(
                                                        "type",
                                                        "tableRow",
                                                        "content",
                                                        List.of(
                                                                Map.of(
                                                                        "type",
                                                                        "tableCell",
                                                                        "content",
                                                                        List.of(
                                                                                paragraph(
                                                                                        "cell")))))))));

        assertThat(NoteContentPolicy.validateAndCopy(source)).isEqualTo(source);

        Map<String, Object> preview = builder.build(source);

        assertThat(preview).isEqualTo(source);
        assertThat(NoteContentPolicy.validateAndCopy(preview)).isEqualTo(preview);
    }

    @Test
    void accountsForEscapedUnicodeTextAndLargeMarkAttributesWithinByteBudget() throws Exception {
        String title = "t".repeat(512);
        List<Map<String, Object>> paragraphs = new ArrayList<>();
        for (int block = 0; block < 6; block++) {
            List<Map<String, Object>> textNodes = new ArrayList<>();
            for (int index = 0; index < 8; index++) {
                textNodes.add(
                        Map.of(
                                "type",
                                "text",
                                "text",
                                "é\\\"\n😀",
                                "marks",
                                List.of(
                                        Map.of(
                                                "type",
                                                "link",
                                                "attrs",
                                                Map.of(
                                                        "href",
                                                        "https://example.com/",
                                                        "title",
                                                        title)))));
            }
            paragraphs.add(Map.of("type", "paragraph", "content", textNodes));
        }
        Map<String, Object> source = documentWithBlocks(paragraphs);

        assertThat(NoteContentPolicy.validateAndCopy(source)).isEqualTo(source);

        Map<String, Object> preview = builder.build(source);

        assertThat(preview).isNotNull();
        assertThat(new ObjectMapper().writeValueAsBytes(preview))
                .hasSizeLessThanOrEqualTo(16 * 1024);
        assertThat(content(preview).size()).isLessThanOrEqualTo(6);
        assertThat(NoteContentPolicy.validateAndCopy(preview)).isEqualTo(preview);
        assertThat(content(preview).getFirst()).isEqualTo(paragraphs.getFirst());
        assertThat(text(preview)).startsWith("é\\\"\n😀");
    }

    @Test
    void stopsWhenTheRequiredNestedPrefixCannotFitInsteadOfPromotingLaterContent() {
        String title = "x".repeat(512);
        List<Map<String, Object>> marks = new ArrayList<>();
        for (int index = 0; index < 40; index++) {
            marks.add(
                    Map.of(
                            "type",
                            "link",
                            "attrs",
                            Map.of("href", "https://example.com/", "title", title)));
        }
        Map<String, Object> source =
                documentWithBlocks(
                        List.of(
                                Map.of(
                                        "type",
                                        "bulletList",
                                        "content",
                                        List.of(
                                                Map.of(
                                                        "type",
                                                        "listItem",
                                                        "content",
                                                        List.of(
                                                                Map.of(
                                                                        "type",
                                                                        "paragraph",
                                                                        "content",
                                                                        List.of(
                                                                                Map.of(
                                                                                        "type",
                                                                                        "text",
                                                                                        "text",
                                                                                        "required",
                                                                                        "marks",
                                                                                        marks))))))),
                                paragraph("later-sentinel")));

        assertThat(NoteContentPolicy.validateAndCopy(source)).isEqualTo(source);

        assertThat(builder.build(source)).isNull();
    }

    @Test
    void omitsAnIncompleteNestedStructureAtTheTextBoundary() {
        Map<String, Object> source =
                Map.of(
                        "type",
                        "doc",
                        "content",
                        List.of(
                                Map.of(
                                        "type",
                                        "bulletList",
                                        "content",
                                        List.of(
                                                Map.of(
                                                        "type",
                                                        "listItem",
                                                        "content",
                                                        List.of(
                                                                Map.of(
                                                                        "type",
                                                                        "paragraph",
                                                                        "content",
                                                                        List.of(
                                                                                Map.of(
                                                                                        "type",
                                                                                        "text",
                                                                                        "text",
                                                                                        "x"
                                                                                                .repeat(
                                                                                                        521))))))))));

        Map<String, Object> preview = builder.build(source);

        assertThat(text(preview)).isEqualTo("x".repeat(520));
        assertThat(NoteContentPolicy.validateAndCopy(preview)).isEqualTo(preview);
    }

    private static Map<String, Object> document(List<String> paragraphs) {
        List<Map<String, Object>> content = new ArrayList<>();
        for (String paragraph : paragraphs) {
            content.add(
                    Map.of(
                            "type",
                            "paragraph",
                            "content",
                            List.of(Map.of("type", "text", "text", paragraph))));
        }
        return new LinkedHashMap<>(Map.of("type", "doc", "content", content));
    }

    private static Map<String, Object> paragraph(String text) {
        return Map.of(
                "type", "paragraph", "content", List.of(Map.of("type", "text", "text", text)));
    }

    private static Map<String, Object> documentWithBlocks(List<Map<String, Object>> blocks) {
        return Map.of("type", "doc", "content", blocks);
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> content(Map<String, Object> document) {
        return (List<Map<String, Object>>) document.get("content");
    }

    private static String text(Map<String, Object> document) {
        StringBuilder result = new StringBuilder();
        appendText(document, result);
        return result.toString();
    }

    private static void appendText(Object node, StringBuilder result) {
        if (node instanceof Map<?, ?> map) {
            if ("text".equals(map.get("type"))) result.append(map.get("text"));
            Object children = map.get("content");
            if (children instanceof List<?> list) list.forEach(child -> appendText(child, result));
        }
    }
}
