# Issue #76 / PR #96 — Final Review Remediation Implementation Plan

> **For Luna:** REQUIRED SUB-SKILLS: `superpowers:executing-plans`, `superpowers:test-driven-development`, and `superpowers:verification-before-completion`. Execute inline, task by task, **no subagents**. The owner requested publication of this plan to the existing PR. This is not authorization to merge or accept outstanding security/policy exceptions.

**Goal:** Correct the narrow R3-01 Office XML regression and close the outstanding acceptance gates, without another broad refactoring cycle.

**Architecture:** Preserve the existing File foundation, public contracts, storage port, schema, transaction boundaries and all resolved review findings. Restore complementary executable and secure XML inspection at the existing Office validator boundary; do not expand file-format or parser policy.

**Tech stack:** Existing Java 25, Spring Boot 4.0.6, PostgreSQL/Flyway, AWS SDK 2.59.2, pinned SeaweedFS 4.54, POI 6.0.0, PDFBox 3.0.8, TwelveMonkeys WebP 3.15.3, Maven/Testcontainers. No new runtime dependency.

**Spec:** [Approved design](https://github.com/krishna916/horizon/blob/506c0777a0eb8930097d08c144642dae1e6e7a04/docs/superpowers/specs/2026-11-25-issue-76-file-foundation-design.md), [original implementation plan](https://github.com/krishna916/horizon/blob/506c0777a0eb8930097d08c144642dae1e6e7a04/docs/superpowers/plans/2026-11-25-issue-76-file-foundation.md), [Round 2 plan](https://github.com/krishna916/horizon/blob/7e249b7c2c207fb56111417fbd5866504979e80b/docs/superpowers/plans/2026-11-26-issue-76-round-2-remediation.md), [Round 2 closure matrix](https://github.com/krishna916/horizon/pull/96#issuecomment-7197127101).

**Baseline:** PR #96, branch `feature/76-file-foundation`, head [3db1db4](https://github.com/krishna916/horizon/commit/3db1db43fa551f153b76dc388cf745c614b7c4df). [CI 45760905000](https://github.com/krishna916/horizon/actions/runs/45760905000) all four jobs passed; backend logs confirm 466 tests, zero failures/errors/skips; SonarCloud 81.0% new-code coverage, 0 hotspots, 99 new issues. RR-01, RR-02, RR-04 accepted at focused source review; RR-03 original executable-path defect fixed, but R3-01 remains. No new TDD RED evidence was claimed in Round 2.

## Global constraints

- Preserve eleven D76 approvals, including 20,971,519-byte inclusive default and 104,857,600-byte inclusive configurable ceiling, historical verified-file validity after reduction, no aggregate quota. Preserve approved parser bounds, existing four-slot staging default and 64 KiB copy buffer.
- No new public API, HTTP routes, runtime library, parser signatures/thresholds, MIME policy, transaction/retry/settlement behavior or storage provider changes. No #77 worker, #78–80 consumer work, Note/Task/Journal production changes or #68 UX changes.
- Preserve durable unique attempt locator before each PUT, no PUT retries, independent GET verification and indefinite unresolved locator retention absent authoritative settlement. Do not reopen resolved RR-01/02/04 or CR findings unless concrete regression evidence emerges.
- Follow `server/AGENTS.md`. Use repository sources; ChatGPT Project source synchronization deferred. No unrelated refactors or mass Sonar suppressions. No skipped required Docker tests, fabricated RED evidence, or blanket security clearance claims. Obtain owner approval for any new decision, dependency remediation or exception. No merge/issue closure.
- Paths below: J = `server/src/main/java/com/krishnamurti/horizon/file/`; T = `server/src/test/java/com/krishnamurti/horizon/file/`. Maven commands run from `server/`.

## Review focus

- A non-XML-named OPC part declared as XML must still undergo secure XML inspection; malformed XML or prohibited DTD/entity content is rejected (Task 1).
- An XML-named part declared binary must still undergo secure inspection (Task 1 existing regression).
- Executable signatures in nonstandard parts with misleading XML MIME must still be rejected, not excluded by the XML branch (Task 1 existing regression).
- Benign XML under a nonstandard extension must not be rejected merely for the extension if declared XML and otherwise valid (Task 1).
- Validation rejection must occur before transfer attempt registration or storage PUT; staged resources remain correctly accounted for (Task 1 service regression).

---

## Task 0 — Confirm baseline and remaining approvals

**Read:** Original spec, Round 2 plan Task 0, closure comment, `docs/architecture/validation/ISSUE-76-FILE-VALIDATION.md`, current PR head and CI. No production changes.

- [ ] Verify current HEAD descends from reviewed baseline; inspect intervening commits and ensure source amendments remain incorporated.
- [ ] Recover actual owner approvals from Luna's session for Round 2 Task 0: canonical MIME matrix (including Mermaid, no generic binary fallback, optional UTF-8 text charset); eight `FileOperationException.Reason` values and exact RR-02 mapping; `FileValidator.validate(StagedFile, FileFormat)`; caller-download timeout unchanged; approved numeric parser ceilings and no additional numeric limits; terminal tombstone constraints and historical facts; bounded existing executable-prefix inspection. Record explicit references or request a compact confirmation from owner. Do not invent prior approvals or treat plan publication as security waiver. Independent R3-01 regression repair can proceed without reopening unrelated settled choices.
- [ ] Record outstanding security and quality gates for Task 2. Keep original POC/spec history intact.

## Task 1 — R3-01: Restore complementary XML and executable inspection (P2)

**Modify:** `J/infrastructure/validation/OfficeFileValidator.java`, `scanPackageParts(OPCPackage)` at reviewed lines 242–266. **Tests:** `T/infrastructure/validation/OfficeFileValidatorTest.java`, `T/application/FileTransferIntegrationTest.java`; existing `FileValidationServiceTest.java` for dispatch regression. **Documentation:** `docs/architecture/validation/ISSUE-76-FILE-VALIDATION.md` only if its wording needs correction.

**Interfaces:** `FileValidator.validate(StagedFile, FileFormat): ValidationResult` unchanged; existing `hasExecutableSignature(PackagePart): boolean`, `isXmlEntry(String): boolean`, `scanXml(XMLInputFactory, InputStream): void` retained. No new public types.

- [ ] **RED:** Add `nonXmlPathWithDeclaredXmlTypeRejectsProhibitedXml` in OfficeFileValidatorTest using existing `officeEntries` and `addContentTypeOverride` helpers. Construct otherwise valid DOCX with a nonstandard part path such as `custom/metadata.bin`, content type `application/xml` (and an applicable `+xml` type in a parameterized case), and harmless prohibited DTD/entity XML using an internal entity, not a real external target. Assert `validate(fixture.file(), FileFormat.DOCX)` throws IllegalArgumentException for secure XML rejection. Also test malformed XML. Ensure package/root/content-type structure is valid so the failure is attributable to XML inspection; if POI already rejects a fixture, record characterization and choose a valid package that reaches the relevant branch rather than claim RED. Add a benign well-formed XML counterpart using the same path/type, expected DOCX acceptance. Retain existing `executableAtNonstandardPartPathIsRejectedDespiteMisleadingXmlType`, `xmlPathIsSecurelyParsedDespiteMisleadingBinaryType`, external hyperlink, root/namespace, XXE, macro and expansion tests.
- [ ] Add service-level `nonstandardOfficeXmlRejectedBeforeAttemptRegistration`: prepare a matching DOCX descriptor and supply the rejected synthetic package with correct size/hash. Assert `FileOperationException.reason() == INVALID_CONTENT`, zero PUT, zero attempts for File UUID, no selection, no staging reservation/temp leak on normal deletion. Reuse existing test fixtures/helpers; do not expand public APIs.
- [ ] Run `./mvnw test -Dtest=OfficeFileValidatorTest,FileValidationServiceTest,FileTransferIntegrationTest`. Expected RED specifically on uninspected XML path/type fixture; capture actual result, no fabricated RED. If evidence disproves R3-01, report counter-evidence and preserve existing protections rather than introduce speculative code.
- [ ] **GREEN:** In `scanPackageParts`, preserve existing filename/content-type macro/executable rules, then make prefix and XML checks independent. Apply the same bounded MZ/ELF/shebang prefix inspection irrespective of declared type/path; separately run existing secure XML inspection when `isXmlEntry(name) || contentType.endsWith("+xml") || contentType.equals("application/xml")`. This restores both path-based and declared-type protection. Reuse existing preflight/secure XML reader and bounded prefix method, avoid unnecessary extra parsing where already guaranteed by preflight, preserve archive limits and no external resolution. No content sniffing policy expansion, new signatures, recursive nested scanning, parser replacement or full malware scanning. If a legitimate fixture regresses or another policy choice is required, stop and seek approval for that choice.
- [ ] Rerun targeted command; expect PASS including both previous RR-03 regressions and benign Office types. Verify actual format/MIME agreement, no provider access on rejection and retained-byte cleanup behavior unchanged.
- [ ] Commit `fix(file): preserve secure XML checks for Office parts`.

## Task 2 — Security/quality and owner acceptance gates

**Read/update:** `server/pom.xml`, resolved Maven dependency tree, `docs/architecture/validation/ISSUE-76-FILE-VALIDATION.md`, current SonarCloud PR analysis and PR discussion. No new permanent scanner/CI dependency required.

- [ ] Reuse or regenerate resolved dependency tree with `./mvnw dependency:tree -DoutputType=text -DoutputFile=/tmp/horizon-issue76-dependency-tree.txt`. Perform a one-off advisory assessment of the actual resolved direct/transitive Maven versions using an available authorized advisory mechanism (scanner-backed preferred). Capture tool/version, date, inputs, coverage, results and limitations. If no scanner is installed, seek owner approval if installation/external access is necessary; a documented manual advisory assessment is acceptable evidence only to its actual scope. Do not claim a scan based on dependency resolution or Sonar zero hotspots. If no assessment is possible, request explicit owner acceptance of the unresolved limitation before recommending merge. For actual findings, report artifact/version, advisory, severity, relevance and proposed fix; obtain approval before changing approved pins or dependencies.
- [ ] Review visible substantive Sonar production issues/annotations, prioritize correctness/security/resource/concurrency findings; document rule/severity/file/disposition where available. Do not chase the issue count or broadly refactor validator complexity. Previous review exposed 50 of 99 annotations, full issue details inaccessible; if still inaccessible, report scope and ask owner to explicitly accept incomplete triage. Do not characterize unseen issues as harmless. Any new material defect outside R3-01 requires review, not automatic scope expansion.
- [ ] Record Task 0 approvals and Task 2 evidence or owner-accepted exceptions in validation documentation/PR discussion, with links or explicit confirmation text. Commit relevant documentation as needed. Unresolved approval or security/quality limitation is an open acceptance gate, not silently closed.

## Task 3 — Final verification and handoff

**Files:** relevant Task 1–2 changes, PR #96 description and final closure comment.

- [ ] Run `cd server && ./mvnw test && ./mvnw verify`. Record actual counts, failures/errors/skips and Spotless/ErrorProne/SpotBugs/JaCoCo results. Ensure real-provider, restart, actual HTTP deadline and staging tests execute; no skips. Review minimal diff against 3db1db4: no unrelated changes, preserve RR-01/02/04 and earlier CR fixes, no #77–80 scope leakage.
- [ ] Update PR #96 description with actual latest head, latest test count/CI link, Sonar measures and accurate security limitations (currently stale 457-test baseline). Preserve earlier evidence in historical comments, not as current results. Check final CI for exact new head; report pending/failing checks rather than assume success.
- [ ] Post compact final closure comment: R3-01 resolution and code/test links, actual RED/GREEN or characterization evidence, commit SHA, test counts, exact CI run, preservation of RR-01–04, actual approval references, advisory assessment outcome or explicit owner waiver, Sonar triage scope or accepted limitation. Request focused final review. Do not assert completion of #77 or merge/close PR/issue; leave Project sources untouched.

## Definition of done

R3-01 either corrected with focused regression evidence or disproven by concrete counter-evidence; previous Office executable and XML protections preserved; all required suites and CI pass for final head; pending policy approvals recorded; dependency and quality review evidence completed or limitation explicitly accepted by owner; PR description current. No further broad remediation cycle solely for stylistic issues. No merge recommendation while required gates remain unresolved.

**Plan self-review:** R3-01 and all remaining review gates map to Tasks 0–3; test paths and method signatures match reviewed source. Proposed implementation restores existing requirements rather than adding new policy. No code execution or approval of security exceptions is claimed by this plan. Execute inline after owner review.
