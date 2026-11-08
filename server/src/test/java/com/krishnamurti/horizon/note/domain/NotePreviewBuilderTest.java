package com.krishnamurti.horizon.note.domain;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.charset.StandardCharsets;
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
        List<Map<String, Object>> manyBreaks = new ArrayList<>();
        for (int index = 0; index < 9_990; index++) manyBreaks.add(Map.of("type", "hardBreak"));
        Map<String, Object> source =
                Map.of(
                        "type",
                        "doc",
                        "content",
                        List.of(Map.of("type", "paragraph", "content", manyBreaks)));

        Map<String, Object> preview = builder.build(source);

        assertThat(new ObjectMapper().writeValueAsString(preview).getBytes(StandardCharsets.UTF_8))
                .hasSizeLessThanOrEqualTo(16 * 1024);
        assertThat(builder.build(null)).isNull();
        assertThat(builder.build(Map.of("type", "doc", "content", List.of()))).isNull();
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
