# Issue #75 S3 compatibility POC report

## Scope and current state

This is a standalone architecture proof only. No production File module, Note code, migrations, or main application build/deployment configuration is part of this POC. Issue #75 remains open; the draft File ADR in PR #93 remains unaccepted.

**Run status:** Standalone harness is implemented on branch `poc/75-s3-compatibility`; the Compose service is stopped and the dedicated evidence volume is retained. The initial compose startup timed out while pulling the approved SeaweedFS image; after it finished pulling, the test suite exposed and fixed Testcontainers image alias handling and the expected provider error classification. A01–A16 and B01–B13 now pass in the complete standalone suite (29 tests, 0 failures/errors). B01–B10 use the disposable PostgreSQL/SeaweedFS state-machine proof; B11–B13 are behavioral models only. A14/A15 expose a post-delete late-object risk, and B07 shows the durable attempt must remain tracked when settlement is unknown; see `DECISION-OPTIONS.md`. The first, failed startup attempt made no S3 requests.

## Approved pins

| Component | Version / digest | Source | Rationale | Approved? |
|---|---|---|---|---|
| SeaweedFS | 4.54; `ghcr.io/chrislusf/seaweedfs:4.54@sha256:e7d4b80af9bd49b2630a60ac6fbb7ffb620ac6a2c501f689c22a71b9f89f0203` (linux/amd64; index `sha256:4b42c212543a0acd4c0e675215ecdcaf62a186ef98def76c7e12701871222d15`) | [Official SeaweedFS Docker docs](https://github.com/seaweedfs/seaweedfs/blob/4.54/docker/README.md); [4.54 image index](https://github.com/seaweedfs/seaweedfs/pkgs/container/seaweedfs) | Executable release image; exact child digest selected from verified multi-platform release index. | Yes — user approved 2026-11-22 (corrected) |
| AWS SDK for Java v2 | 2.59.2 | [Official AWS SDK releases](https://github.com/aws/aws-sdk-java-v2/releases/tag/2.59.2) | Recent stable v2 release; use AWS SDK BOM to keep S3 artifacts aligned. | Yes — user approved 2026-11-22 |
| Testcontainers for Java | 2.0.5 | [Official Testcontainers Toxiproxy module docs](https://java.testcontainers.org/modules/toxiproxy/) | Current documented Java module version. | Yes — user approved 2026-11-22 |
| Toxiproxy | 2.13.0; `ghcr.io/shopify/toxiproxy:2.13.0@sha256:5d3dae09bc185dcc5ff6cf43abf6062a4a720aff0c4306a471e773acdcd107aa` | [Official package versions](https://github.com/Shopify/toxiproxy/pkgs/container/toxiproxy) | Current stable release; multi-architecture manifest digest verified with `docker buildx imagetools inspect`. | Yes — user approved 2026-11-22 |
| PostgreSQL (Layer B test container) | 17.12; `postgres:17@sha256:9d4105e2fcb1308961d4ee01f0ebc14fdd0497b11243982a4a0935fdb1a8f8dc` (linux/amd64; index `sha256:223efeb196329b55b3b9a13db144956411dbc18e727e59f681c3e0aede6475cf`) | [Testcontainers PostgreSQL module](https://java.testcontainers.org/modules/databases/postgres/) and official image manifest inspection | Disposable protocol simulator only; no connection to Horizon application data. | Selected for authorized Layer B proof; not a production version decision |
| PostgreSQL JDBC (Layer B test dependency) | 42.7.14 | [Official pgJDBC releases](https://github.com/pgjdbc/pgjdbc/releases) | Pinned JDBC driver for the disposable harness. | Test-only dependency; not a production version decision |

## Environment

| Check | Observed |
|---|---|
| OS / architecture | Ubuntu 26.04.1 LTS / x86_64 |
| Docker Engine | 29.9.2; daemon reachable with elevated command access |
| Docker Compose | 5.6.1 |
| Java | Temurin 25.0.4 LTS |
| Maven wrapper | Maven 3.9.16 |
| Disk available | 385 GiB |
| Host port 8333 | Free at check time |
| Existing Horizon data | Not used; all POC data will be isolated to its dedicated volume |

## Results

The cases below were exercised by the complete combined run; each row reflects observed test evidence rather than a planned or inferred result. `PASS (model only)` is a behavioral contract simulation, not application integration proof.

| Case | Status | Evidence |
|---|---|---|
| A01 | PASS | Signed ListBuckets found the configured private test bucket; sanitized observation in `observations.md` |
| A02 | PASS | Wrong-key S3 request and unsigned GET both returned HTTP 403; sanitized observation in `observations.md` |
| A03 | PASS | Complete run: PUT/HEAD/GET preserved 4,097 bytes and SHA-256 `f56d3e38e0970f948b99efa975be6fa8ad03c904c91f02c657ccc69a36ff043e`; ETag was distinct |
| A04 | PASS | Bounded temp-file policy accepted 20,971,519 bytes and rejected 20,971,520, unknown length, and declared/observed mismatch before PUT; rejected keys returned HEAD 404 |
| A05 | PASS | Mutated bounded temp file failed SHA-256 validation before PUT; independent HEAD returned 404 |
| A06 | PASS | Repeated DELETE left key absent; independent HEAD returned HTTP 404 |
| A07 | PASS | Complete run removed/recreated the container with the same named volume; GET preserved 1,000,003 bytes and SHA-256 `5da2c522760ea64ed34dcc142badb5a324dd97531d5a3f8b942e23ae1a374fe0` |
| A08 | PASS | SDK sent `If-None-Match: *`; first PUT succeeded, second returned HTTP 412, original payload remained intact |
| A09 | PASS | Five barrier-synchronized concurrent conditional PUT trials each had one accepted writer and one complete matching visible payload |
| A10 | PASS | Unavailable endpoint produced one-attempt `SdkClientException` in 5 ms; direct HEAD found no object; subsequent direct healthy-path PUT stored and verified bytes |
| A11 | PASS | Local TCP gate reset after forwarding at least 65,536 body bytes from a 4 MiB PUT; direct GET found no object |
| A12 | PASS | Gate observed provider HTTP 200 after a 1 MiB PUT, dropped client response; SDK lacked success response; direct GET verified exact payload |
| A13 | PASS | Container recreated on same volume with PUT held after 65,536+ body bytes; after restart direct GET found no object |
| A14 | PASS (risk observed) | DELETE returned HTTP 204 at a held 2 MiB PUT body barrier; writer then succeeded and direct GET found the complete object after DELETE |
| A15 | PASS (risk observed) | In repeated five-trial conditional PUT/DELETE overlaps, successful PUTs left complete objects visible after DELETE; full-suite runs also recorded bounded 5 s SDK attempt timeouts followed by absent objects. A separate five-trial rerun had five complete visible objects. No partial bytes observed. |
| A16 | PASS | Missing HEAD returned HTTP 404 and provider code `NoSuchKey` |
| B01 | PASS | PostgreSQL intent and attempt locator survived coordinator reconstruction before any PUT |
| B02 | PASS | S3 PUT committed; injected DB transaction rollback left the locator; direct reconciliation verified bytes and cleanup removed them without attachment |
| B03 | PASS | Identical UUID/content/Note/role returned the same File ID, attempt ID, key, and one durable attempt |
| B04 | PASS | Changed Note, role, length, or checksum conflicted; expired request stayed terminal |
| B05 | PASS | Stale Note version rejected finalize; uploaded bytes remained and version refresh finalized without another PUT |
| B06 | PASS | Concurrent parent claims on one File ID resulted in one PostgreSQL claim/association |
| B07 | PASS (POC model) | Early absent HEAD retained the UNKNOWN attempt; after late 2 MiB PUT commit, restarted reconciliation found/deleted it and retained the row. Unknown-attempt closeout remains unresolved. |
| B08 | PASS (POC model) | Logical removal stayed tombstoned/inaccessible after S3 DELETE failure; restarted coordinator retried and verified deletion |
| B09 | PASS | Verified physical deletion retained terminal tombstone and same UUID could not resurrect |
| B10 | PASS | Lost finalize response replay returned the same committed File/version without a second claim or version increment |
| B11 | PASS (model only) | Ordinary content PATCH preserved the protected inline-image association |
| B12 | PASS (model only) | Repeated inline refs shared one association; explicit last removal detached it while bytes remained for cleanup |
| B13 | PASS (model only) | Archive stayed readable; Trash denied ordinary reads but retained association/bytes; restore restored access |

## Safety and teardown

The eventual Compose project will use a dedicated named volume and test-only credentials. Only that volume may be removed during teardown, after persistence evidence is recorded. No `.env` file, credentials, request authorization headers, raw binary fixture, or unredacted proxy trace may be committed.

## Current interpretation

Observed provider behavior supports authenticated path-style AWS SDK v2 operations, bounded application-side length/checksum validation, same-volume restart persistence, and conditional object creation including concurrent writers for the tested cases. A02 established rejection of both invalid credentials and unsigned reads. A03 independently verified returned bytes and SHA-256; ETag is not the SHA-256. A06 repeated deletion is idempotent from the observed API result, and A16 maps a missing key to `NoSuchKey`/404. These are provider/SDK observations for the exact pinned versions, not production File-module proof. A14 and A15 demonstrate that neither DELETE nor `If-None-Match: *` fences a PUT already receiving bytes: complete objects can appear after DELETE. A12 independently confirms an unknown-result window even when the provider committed successfully. Stable-key conditional writes alone are unsafe as a cleanup/recovery protocol. Layer B exercised per-attempt keys, durable attempt tracking, tombstones, and retryable cleanup against the observed cases. B07 deliberately keeps an unknown attempt row after deleting a late object; a finite rule for retiring unknown rows and a bound on arbitrary provider-side delay remain unproven. B11–B13 are contract models only.

## Pending gates

- A01–A16 and B01–B13 proof suite — complete; combined run: 29 tests, 0 failures/errors.
- Human review remains needed before treating the POC model as a production recovery decision or accepting the draft ADR.
- Keep PR #93 unmerged and Issue #75 open pending explicit ADR/source-document review and acceptance.

## Historical image startup correction

**Initial result: FAILED before any S3 request.** The user-approved reference `ghcr.io/seaweedfs/seaweedfs:4.54.0@sha256:7cb5cb29c7c0358a7c9f68ccdb0a79a46cfdb5c45194d843b5d183fef4e1f21a` resolves to a 95,473-byte OCI manifest with empty image config, no command, and no OS/architecture. Compose therefore tried to execute `mini` directly and container creation failed. No compatibility conclusion can be drawn from this startup error.

The pinned release's official Docker documentation identifies the runnable image repository as `ghcr.io/chrislusf/seaweedfs`; its 4.54 release index resolves to `sha256:4b42c212543a0acd4c0e675215ecdcaf62a186ef98def76c7e12701871222d15`, with a Linux/amd64 image manifest `sha256:e7d4b80af9bd49b2630a60ac6fbb7ffb620ac6a2c501f689c22a71b9f89f0203`. The user approved this replacement digest on 2026-11-22. Compose uses it with the image default command; it started successfully. The first test invocation timed out only because the image pull exceeded the harness’s 30-second Compose command timeout; after pull completion, all A and B cases ran.

Sources: [SeaweedFS 4.54 Docker documentation](https://github.com/seaweedfs/seaweedfs/blob/4.54/docker/README.md), [official image package](https://github.com/seaweedfs/seaweedfs/pkgs/container/seaweedfs).
