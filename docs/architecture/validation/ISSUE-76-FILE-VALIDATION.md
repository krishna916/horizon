# Issue #76 File validation implementation

This note records the server-side validation behavior for the initial File format allowlist. Validation runs on a fully staged file before any storage attempt is registered or any S3 request is made. Format strategies return only the detected `FileFormat` and validated media type.

## Limits and behavior

| Family | Implementation | Bounds enforced before/while parsing |
| --- | --- | --- |
| JPEG, PNG, GIF, WebP | JDK ImageIO plus TwelveMonkeys WebP 3.15.3 | Width and height at most 8,192; canvas at most 16,000,000 pixels; at most 100 frames; at most 64,000,000 cumulative decoded frame pixels. GIF and WebP frame counts are scanned from their containers before asking ImageIO for the animation index. Frames are decoded sequentially and flushed. |
| PDF | PDFBox 3.0.8 with non-lenient `PDFParser` | Encrypted files, JavaScript, launch actions, embedded files and rich media are rejected. At most 1,000 pages. `MemoryUsageSetting.setupMainMemoryOnly` and `StagingCapacity` each bound parser scratch to the configured maximum (128 MiB by default and never above it). No page rendering or network resolution occurs. |
| DOCX, XLSX, PPTX | Apache POI 6.0.0 OPC package validation | At most 2,048 entries; at most 32 MiB actual expanded bytes per entry; at most 128 MiB actual expanded bytes total. Reads are counted while inflating; ZIP-reported uncompressed sizes do not control the count. Duplicate and unsafe paths, wrong root parts, macro-enabled content, executable parts, DTDs and entity references are rejected. POI's secure ZIP ratio defaults are retained: 1% minimum inflate ratio and its 100 KiB grace size. Only ordinary external hyperlink relationships are allowed; they are parsed as relationship metadata and never fetched. |
| TXT, MD, CSV, MMD, Mermaid | Streaming UTF-8 decoder in `REPORT` mode | Optional UTF-8 BOM; invalid sequences, NUL and disallowed controls are rejected. Standalone HTML/SVG document markers and executable signatures are rejected. Markdown HTML remains source text for the future #80 sanitizer. |

The extension aliases are `.jpg` → JPEG and `.mmd` → Mermaid. Validation requires the extension, declared media type, and detected format to agree. Media types are compared case-insensitively. Only the canonical types below are accepted, with an optional single `charset=utf-8` parameter for text formats; generic `application/octet-stream`, unapproved aliases, other parameters, and mismatches are rejected. The current canonical media types are `image/jpeg`, `image/png`, `image/webp`, `image/gif`, `application/pdf`, the three registered OOXML types, `text/plain`, `text/markdown`, `text/csv`, and `text/vnd.mermaid`. Mermaid's ecosystem recommends `text/vnd.mermaid`; IANA registration remains pending, so this mapping should be confirmed during review.

## Resource evidence and limits

Image and Office scans use fixed-size streaming buffers and do not load whole staged files into byte arrays. The ZIP preflight opens each entry once for actual expanded-byte accounting and parses XML through a DTD-disabled, external-entity-disabled StAX reader. PDFBox's configured scratch bound covers its parser scratch store; it is not a cap on total JVM heap or the rest of Horizon. Image decoder internals likewise do not expose a total-process heap budget.

The adversarial validator tests exercise the 8,192 dimension ceiling, 100/101 frame boundary, cumulative-pixel rejection before each subsequent frame decode, malformed/encrypted/active PDFs, 1,001-page rejection, exhausted scratch admission, four concurrent PDF validations competing for the approved scratch budget, 32 MiB-plus-one entry rejection, false ZIP uncompressed-size headers, high compression ratio, 128 MiB configured aggregate behavior, duplicate/traversal paths, external entities, executable parts, invalid UTF-8 and MIME/extension mismatches. Small generated WebP/GIF animation fixtures are documented in `server/src/test/resources/file/fixtures/README.md`.

On the development environment (JDK 25, Maven wrapper), `/usr/bin/time -v ./mvnw -q test -Dtest=ImageFileValidatorTest,PdfFileValidatorTest,OfficeFileValidatorTest,TextFileValidatorTest,FileValidationServiceTest` completed in 19.33 seconds wall time with 649,248 KiB maximum resident set for the Maven/test process. This run includes four simultaneous PDF validations. The Office cases include a 32 MiB-plus-one expanded entry and a 2 MiB payload with its ZIP uncompressed-size headers falsified; the PDF cases include 1,001 pages and an exhausted 128 MiB scratch reservation. This is a local test-process measurement, not a per-parser heap guarantee or production capacity estimate.

These controls bound input, decoded pixels, page count, archive expansion, scratch admission and concurrent File operations. No additional parser depth, object-count, CPU, or heap thresholds were added: the approved decision was to add no numeric limits without evidence. The concurrent test demonstrates reservation and rejection behavior, not a process-wide heap guarantee. These controls do not impose an operating-system memory sandbox or a hard parser wall-clock deadline, and they do not provide malware scanning. In-process parser time can vary with content; there is no safe thread-level timeout that guarantees termination of native/JDK decoder work. Do not describe this implementation as a complete sandbox. Any later hard CPU isolation or malware scanning decision is outside the approved #76 design.

The implementation compiled and passed the repository's Maven quality gates with the approved existing parser/provider versions. The repository environment did not have an OSV, Grype, Trivy, or OWASP Dependency-Check scanner available, and no dependency vulnerability scan is configured in the repository CI. The resolved dependency tree was captured for compatibility review, but this is not a vulnerability clearance; a scanner-backed advisory assessment remains outstanding.

## Round 2 review evidence (2026-11-26)

- The resolved tree was captured with `./mvnw dependency:tree -DoutputType=text -DoutputFile=/tmp/horizon-issue76-dependency-tree.txt` on Java 25.0.4. This confirms Maven resolution only. No advisory database scan was available or completed; the dependency security assessment remains incomplete and requires explicit owner acceptance before any merge recommendation.
- CI run [45760047167](https://github.com/krishna916/horizon/actions/runs/45760047167) passed backend Maven verification, frontend verification, Playwright, and SonarCloud for commit `9eb76e28e082cc1f94d67b5a0d87552d5327c7a3`. The SonarCloud check reported a passed quality gate, 99 new issues, 0 accepted issues, 0 security hotspots, 81.0% new-code coverage and 0.0% duplication. GitHub exposed 50 issue annotations. The visible annotations are predominantly maintainability/test-style findings (including complexity/refactoring suggestions, test lambdas and `Thread.sleep`); production annotations include Office/Image validator complexity and generic-exception style. The SonarCloud issue-detail page was inaccessible through the available account/browser path, so severity-wide triage of all 99 issues could not be completed. No blanket suppressions or count-driven refactors were made, and these quality-gate results are not a security clearance.
- Round 2 code review and regression tests address the approved correctness findings RR-01 through RR-04. The remaining advisory-scan limitation and incomplete Sonar severity disposition are reported for explicit owner review before merge.

## Pinned library references

- [Apache PDFBox 3.0 migration guide](https://pdfbox.apache.org/3.0/migration.html)
- [Apache POI ZIP security configuration](https://poi.apache.org/components/configuration.html)
- [Apache POI `ZipSecureFile` API](https://poi.apache.org/apidocs/6.0/org/apache/poi/openxml4j/util/ZipSecureFile.html)
- [TwelveMonkeys ImageIO WebP reader](https://github.com/haraldk/TwelveMonkeys)
- [RFC 7763: `text/markdown`](https://www.rfc-editor.org/rfc/rfc7763.html)
- [Mermaid MIME type recommendation](https://mermaid.js.org/ecosystem/integrations-create.html)
