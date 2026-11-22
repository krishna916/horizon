# Issue #75 recovery options from the pinned-provider proof

**Status: approved for disposable Layer B proof on 2026-11-22; not accepted as a production File protocol or ADR.** The user explicitly authorized testing this proposal in the isolated harness.

## Evidence used

- Pins: SeaweedFS 4.54 Linux/amd64 manifest `sha256:e7d4b80af9bd49b2630a60ac6fbb7ffb620ac6a2c501f689c22a71b9f89f0203`; AWS SDK Java v2 2.59.2; Testcontainers 2.0.5; Toxiproxy 2.13.0.
- Full combined standalone run: `./mvnw -f poc/s3-compat/pom.xml test` — 29 tests, 0 failures, 0 errors. B01–B10 exercised the disposable PostgreSQL state machine with SeaweedFS; B11–B13 are behavioral models only. Sanitized per-case observations are in `observations.md`.
- A12 observed SeaweedFS HTTP 200 after a complete PUT at the local test TCP gate, dropped the downstream response, then independently GET-verified the exact 1 MiB payload. The SDK received no success response.
- A14 paused an unconditioned PUT after at least 65,536 request-body bytes had reached SeaweedFS. A direct DELETE returned 204 before the body was released. The PUT then succeeded and a direct GET found the complete payload. The object therefore appeared after DELETE.
- A15 repeated that overlap five times with `If-None-Match: *`. Focused five-trial reruns had five successful late PUTs and five complete objects visible afterward. Complete-suite reruns recorded one or two bounded SDK attempt timeouts (final objects absent after follow-up inspection); remaining trials succeeded with complete objects visible. No partial bytes were observed. Conditional create therefore does not fence a writer that is still receiving bytes when DELETE runs.
- A11 interruption after the same body-byte barrier left no visible object. A13 container recreation while an upload was held at the barrier left no visible object after restart. These outcomes characterize these controlled cases only.
- SDK retries are disabled in the fixture (`RetryPolicy.none()`); timeout outcomes are single-attempt observations. Direct verification uses the independent non-proxied S3 client.

## Option comparison

| Property | A — stable physical object key | B — immutable key for every transfer attempt |
|---|---|---|
| Retry identity | Reuses one S3 key for all attempts | Logical idempotency key stays stable; every network transfer gets a new physical key |
| Duplicate create | `If-None-Match: *` rejects a second create while an object exists; A08/A09 passed | Conditional create can protect each attempt key from duplicate writes |
| Late PUT after DELETE | **Observed risk:** A14 recreated the object; the five-trial focused A15 rerun recreated it in every trial | A late PUT can only create its own attempt key; it cannot overwrite a later attempt's bytes or a reused logical key |
| Durable recovery record | Must retain the stable locator and reconcile it; key alone cannot distinguish old and new writers | Must retain every attempt key and outcome until cleanup is confirmed; logical tombstone prevents promotion or resurrection |
| Cleanup behavior | A successful DELETE is not final while a PUT may still be in flight; requires another inspection/delete after the writer settles | Tombstone and durable retry row remain; worker inspects/deletes each attempt key and retries after late writes |
| What the POC establishes | Not sufficient as the sole fencing/cleanup strategy | Better isolation and discoverability; still needs a durable convergence rule for unknown or late attempts |

## Exercised protocol model for Layer B

1. The caller's idempotency UUID remains stable while each prepared transfer has a durable attempt ID and never-reused physical key. The PostgreSQL intent stores expected size, SHA-256, owner, Note, role, and expiry before PUT (B01/B03).
2. Finalization checks the staged attempt and expected Note version in one database transaction. A stale version rejects association but retains bytes for retry (B05); a committed finalize replay returns the prior claim/version (B10).
3. Expiry/removal writes a terminal logical tombstone and retains the physical attempt locator. Later finalization/retry is rejected. Cleanup failure remains durable and retryable across coordinator reconstruction (B04/B08/B09).
4. B07 held an actual PUT after a body-byte barrier. Expiry/tombstoning changed the attempt to `UNKNOWN`. An early absent HEAD did not retire it. After the late PUT completed, a reconstructed coordinator found and deleted the object while preserving the tombstone and attempt row. This avoided an untracked late object in the exercised case.
5. The simulator deliberately leaves that attempt `UNKNOWN` after byte deletion because it cannot prove a general upper bound for a provider-side request that has lost its coordinator. Reconciliation can keep checking and deleting the durable attempt key; a finite retirement rule for unknown rows was not demonstrated.

The model supports logical non-resurrection and durable cleanup discoverability in the tested scenarios. It does **not** promise immediate physical deletion while a request is in flight or prove a finite bound on arbitrarily delayed writes. A PostgreSQL lease does not cancel an S3 request already in flight; do not erase the last locator based only on timeout, DELETE 204, or one absent HEAD. Production acceptance still needs review of the retained-unknown policy, reconciliation schedule, tombstone retention, and residual orphan window. The actual coordinator is test-only; no production File code was added.

## Approval and remaining production decision

The user approved proceeding with disposable Layer B using unique per-attempt physical keys, durable attempt rows, terminal logical tombstones, and retryable per-attempt cleanup/reconciliation. That approval authorized this proof only. B07 found and deleted a late object while retaining its UNKNOWN attempt row; it did not establish a finite retirement rule for arbitrarily delayed or lost transfer outcomes. Do not treat this evidence as production protocol acceptance, ADR acceptance, or authorization to close Issue #75.
