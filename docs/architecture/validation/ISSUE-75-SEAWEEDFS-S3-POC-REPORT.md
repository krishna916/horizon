# Issue #75 — SeaweedFS S3 compatibility POC: evidence summary

| Field | Recorded result |
| --- | --- |
| Status | **POC completed and documented; production recovery design NOT approved** |
| Date | 2026-11-22 |
| POC issue | [#75](https://github.com/krishna916/horizon/issues/75) |
| Experimental PR | [#94](https://github.com/krishna916/horizon/pull/94) — **not merged**, retained branch `poc/75-s3-compatibility` |
| POC checkout tested | [`d5d3132eee8e9102fdc95e32a55d919d557d3d62`](https://github.com/krishna916/horizon/tree/d5d3132eee8e9102fdc95e32a55d919d557d3d62) |
| Report/evidence snapshot | [PR #94 head `9afce16dde1911f96933f13434b47fac3ce17165`](https://github.com/krishna916/horizon/tree/9afce16dde1911f96933f13434b47fac3ce17165/server/poc/s3-compat) |
| Architecture decision | [Draft File ADR](../adr/ADR-DRAFT-shared-file-object-storage.md), PR #93 — **not accepted** |

> This is a permanent architecture **evidence summary**, not a replacement for the runnable proof or its full logs. The assertions below are based on the committed test sources and Luna's documented clean-checkout results, which were reviewed from GitHub; they were **not independently rerun by the reviewer**. Detailed per-case provenance, test commands, object keys, sanitized observations and results are retained in the separate POC branch.

## 1. Scope of proof

The disposable Java 25/Maven POC exercised AWS SDK Java v2 against a private, pinned single-node SeaweedFS S3 service, plus a PostgreSQL-backed *test-only* recovery coordinator. Its purpose was to verify provider behavior and discover crash/cleanup hazards **before** production File/Note integration.

No production File module, Note code, application Flyway migration, main `server/pom.xml`, or main `server/compose.yaml` was modified by the POC. Future production behaviors still require implementation tests in #76–#80.

### Test environment and pins

| Component | POC version |
| --- | --- |
| SeaweedFS | 4.54; `ghcr.io/chrislusf/seaweedfs:4.54@sha256:e7d4b80af9bd49b2630a60ac6fbb7ffb620ac6a2c501f689c22a71b9f89f0203` (linux/amd64 child manifest) |
| AWS SDK Java v2 | 2.59.2 |
| Testcontainers Java | 2.0.5 |
| Toxiproxy | 2.13.0; `ghcr.io/shopify/toxiproxy:2.13.0@sha256:5d3dae09bc185dcc5ff6cf43abf6062a4a720aff0c4306a471e773acdcd107aa` |
| PostgreSQL (simulation only) | 17.12; Docker image and JDBC driver pinned in full POC report |
| POC execution | Ubuntu 26.04.1 x86_64, Java 25.0.4, Maven 3.9.16, Docker 29.9.2 / Compose 5.6.1 |
| Full run | **29 JUnit methods passed, 0 failed/errors/skipped** on tested checkout |
| Additional fault runs | Four serial `S3FailureTest` runs, each six methods passed; **53 method executions total**, of which 29 are distinct methods |

The originally attempted `ghcr.io/seaweedfs/seaweedfs:4.54.0` image was a non-runnable artifact and failed **before S3 requests**; the approved replacement above was used for the completed proof. This does not indicate a SeaweedFS S3 protocol failure.

## 2. Observed compatibility and hazards

| Cases | Test result / finding | Architectural interpretation |
| --- | --- | --- |
| A01–A03, A06, A16 | Private signed bucket access and wrong/unsigned 403; PUT/HEAD/GET exact bytes and SHA-256; repeated delete and absent 404/NoSuchKey | S3 basic interoperability supported for the **pinned test configuration** |
| A04–A05 | POC-only bounded temp validation accepted **20,971,519 bytes**, rejected 20,971,520/unknown length/mismatch; SHA-256 mismatch rejected before PUT | Validates **harness** policy for D-02/D-26/D-27/D-29, not production file validation |
| A07 | A saved object remained intact after container recreation with the same named volume | Single-machine persistence observed in the test setup |
| A08–A09 | `If-None-Match: *` rejected overwrite (HTTP 412); five concurrent conditional-writer trials each produced one complete winner | Conditional create works for deduplication; **not** fencing of prior in-flight writers |
| A10–A11, A13 | Connection failure bounded; interrupted and restart-affected uploads did not expose partial bytes in exercised trials | Characterizes those fault barriers only, not universal absence of partial/in-flight writes |
| **A12** | Proxy saw provider **HTTP 200** for completed 1 MiB PUT and dropped client response; independent GET matched bytes | **Unknown client outcome after successful commit is real** |
| **A14** | **4/5** held PUTs completed after DELETE returned 204, leaving complete objects visible | **Late write after DELETE hazard reproduced** |
| **A15** | **20/25** held conditional PUTs completed after DELETE, leaving complete objects visible | `If-None-Match: *` alone **does not prevent late post-delete writes** |
| B01–B06, B08–B10 | Disposable PostgreSQL/SeaweedFS simulator exercised persisted intent, DB failure, idempotency, version conflict, claims, durable deletion/replay | Feasibility demonstrations, **not production Note/File code verification** |
| **B07** | Test-only coordinator retained an `UNKNOWN` attempt after negative HEAD, recovered and deleted a delayed object after coordinator reconstruction, preserved locator/tombstone | Durable attempt tracking can discover the **observed** late object; **safe finite UNKNOWN retirement remains unproven** |
| B11–B13 | Simple in-memory behavioral models for inline-image PATCH/reference handling and Archive/Trash/restore | **Not product integration evidence**, and not an approval gate for S3 compatibility |

**Important result-classification distinction:** A14/A15 JUnit **PASS** means the test successfully demonstrated the unsafe storage interleaving without corrupted visible bytes. It does **not** mean an application using one key plus DELETE is safe from orphaned objects.

The report's absence results after SDK timeout are **not proof that an in-flight provider write cannot complete later**.

## 3. Recovery interpretation — what the POC supports, not a production decision

The report compared (A) a single stable physical object key with conditional writes/reconciliation against (B) **new physical keys for each transfer attempt** with a stable logical idempotency request, durable attempt locator(s), and terminal tombstones. The test-only Layer B simulator exercised B.

**Supported evidence:** separately tracked attempt keys prevent a later retry from clobbering an earlier attempt; durable locators and tombstones enabled detection and cleanup of a deliberately delayed object in B07. A PostgreSQL lease expiry, a single negative HEAD, a timeout or a successful DELETE **cannot fence an in-flight S3 PUT** by themselves.

**Open decision:** no provider-side upper bound on unacknowledged request completion and no authoritative server-side writer termination mechanism was proven. Therefore the POC does not justify a **finite, automatically safe** rule for deleting `UNKNOWN` attempt records. Options awaiting explicit review:

1. Retain durable `UNKNOWN` attempt locators and periodically reconcile until **authoritative settlement**, accepting metadata/worker overhead and potentially indefinite retention.
2. Allow finite retirement only after evidence of **valid writer-lifetime bound or authoritative fencing/termination**, followed by inspection/cleanup.
3. Add bucket listing/inventory sweeps as **defense in depth** alongside tracked attempts; inventory alone cannot prevent a write after the final scan.

These are **alternatives, not accepted choices**. Production design must still define progress/retry, lock/lease coordination, terminal idempotency metadata retention, operational bounds and the exact safe closeout condition. #77 will implement and verify worker behavior after approval.

## 4. Source of truth and traceability

- **[POC report (full)](https://github.com/krishna916/horizon/blob/9afce16dde1911f96933f13434b47fac3ce17165/server/poc/s3-compat/results/REPORT.md):** 29-case test/source ledger, environment/pins, repeat counts, run IDs, evidence limits and historical correction.
- **[Observations](https://github.com/krishna916/horizon/blob/9afce16dde1911f96933f13434b47fac3ce17165/server/poc/s3-compat/results/observations.md):** recorded test barriers, responses, object-key references, checksums and PostgreSQL simulator outcomes.
- **[Recovery options](https://github.com/krishna916/horizon/blob/9afce16dde1911f96933f13434b47fac3ce17165/server/poc/s3-compat/results/DECISION-OPTIONS.md):** alternatives, unproven UNKNOWN retirement and approval request.
- **[Runnable harness / reproduction instructions](https://github.com/krishna916/horizon/tree/9afce16dde1911f96933f13434b47fac3ce17165/server/poc/s3-compat):** isolated Compose, pinned Maven, tests, fault gate and README.
- **[Issue #75](https://github.com/krishna916/horizon/issues/75):** approved D-01–D-29 and POC acceptance matrix.
- **[ADR PR #93](https://github.com/krishna916/horizon/pull/93):** proposed architectural contract; final recovery protocol and ADR acceptance pending.
- **[Implementation #76](https://github.com/krishna916/horizon/issues/76)** and **[#77](https://github.com/krishna916/horizon/issues/77):** File foundation and actual recovery worker later.

## 5. Gates and completion

| Gate | Status |
| --- | --- |
| Real private SeaweedFS/AWS SDK operations and controlled fault behavior | **POC evidence completed** for tested pins |
| Executable standalone POC source and clean-checkout report | **Committed in PR #94**; not merged into production branch |
| Architecture D-01–D-29 | Already approved as design directions |
| Provider choice for production | Compatibility evidence supports SeaweedFS candidate; **deployment policy remains subject to final architecture approval** |
| Safe `UNKNOWN` attempt settlement/retirement policy | **Not selected; requires explicit decision** |
| Actual File/Note/worker implementation, exact DDL/HTTP contracts | #76–#80; not authorized by the POC |
| PRD/Constitution reconciliations | **Still pending separately approved updates** |
| ADR #93 acceptance/merge and issue #75 closure | **Not automatically implied by POC result** |

**Record as complete POC evidence, not proof of all production guarantees.** Keep the POC branch `poc/75-s3-compatibility` available and reference the immutable commits. Do not require merging experimental code into `master` for traceability.

## Post-POC architecture disposition (2026-11-22)

**Subsequent to this evidence report**, the user agreed to the recommended conservative V1 recovery direction. See [draft ADR §7.2](../adr/ADR-DRAFT-shared-file-object-storage.md) and [#75](https://github.com/krishna916/horizon/issues/75) for the current architecture record. **Select distinct never-reused physical keys per new PUT, persist each attempt before transfer, and retain/reconcile UNKNOWN attempt locators for as long as the provider's outcome cannot be authoritatively settled (potentially indefinitely).** No automatic retirement based on timeout, DELETE success or negative HEAD. This does **not** change what the POC proved: B07 did not establish a finite bound on delayed writes, and #76/#77 must verify the actual production mechanism. Exact schema, worker lease/retry mechanics, source-document reconciliation and ADR acceptance remain review gates. The historical POC options and per-case results above are preserved as originally observed.
