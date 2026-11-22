# Issue #75 recovery and UNKNOWN-attempt options

**Production recovery strategy: PENDING.** User authorization covered the disposable Layer B test only. It did not accept a production File protocol or draft ADR PR #93.

## Evidence and limits

The clean PR-head run on `52b1b1b9e806080174614d97e777c6c2c524896a` completed 29 JUnit methods with no failures, errors, or skips. Four additional `S3FailureTest` runs also passed. A14 reproduced a complete object appearing after DELETE in 4/5 controlled races. A15 reproduced it in 20/25 conditional PUT/DELETE trials. Five other A15 attempts timed out after the SDK's one 5-second attempt and had an absent follow-up GET; this does not establish that an outstanding remote write cannot commit later. A12 objectively observed provider HTTP 200 before the gate dropped the client response, then an independent read verified the complete payload.

B01–B10 run against a disposable PostgreSQL/SeaweedFS protocol simulator. B07 exercised one late PUT: an early absent HEAD retained the durable UNKNOWN attempt, and a reconstructed coordinator later found and deleted the committed bytes while keeping the tombstone/locator. B08 exercised durable logical removal and retry after S3 DELETE failure. B11–B13 are in-memory behavioral contract models only. None of these cases demonstrates Notes production integration, a provider-side maximum request lifetime, or authoritative cancellation of an in-flight S3 PUT.

Full run IDs, source/test mapping, test counts, container digests and per-case observations are in [`REPORT.md`](REPORT.md) and [`observations.md`](observations.md).

## Stable-key protocol finding

Using one physical key with `If-None-Match: *` protects the first visible object from an ordinary overwrite. It does **not** fence a writer already uploading when DELETE runs. The controlled A14/A15 races showed that a late PUT can create a complete object after HTTP 204 from DELETE. Therefore stable-key conditional PUT plus a single DELETE or a negative HEAD is not a safe cleanup protocol by itself.

## UNKNOWN-attempt closeout options

| Option | Metadata and restart recovery | Worker / storage cost | Permanently untracked orphan? | What must be proven before terminal deletion |
|---|---|---|---|---|
| **1. Retain each UNKNOWN attempt and reconcile until authoritative settlement** | Retain the logical tombstone, attempt ID, and unique physical key indefinitely; reconstruction can resume from PostgreSQL. Row count can grow without a known closeout bound. | Repeated per-key inspect/delete and retry work; storage may persist while a writer remains active or fails to settle. | No untracked key while the row is retained and the reconciler remains operational. This does not promise a finite time to physical cleanup. | An authoritative terminal result or a proven condition that rules out any later commit, followed by verified physical absence. One timeout, lease expiry, DELETE 204, or negative HEAD is insufficient. |
| **2. Finite retirement after a valid upper bound or authoritative fencing/termination** | Rows can be retired after the bound/fence is durable and recoverable across restart. Metadata is bounded only if the premise holds. | Bounded reconciliation and retention after settlement. Proving the premise may require provider semantics or a separate fencing mechanism. | Only if the bound/fence proves that no writer can commit after retirement. The current POC does not establish this. | Evidence of a valid maximum request lifetime with a wait/settle rule, or an authoritative mechanism that stops/invalidates all in-flight writes; then verify absence after that condition. |
| **3. Provider inventory/sweep plus per-attempt keys as defense in depth** | Keep attempt records and persist inventory cursors/checkpoints; a restarted worker can resume scans. Inventory alone does not encode active writers. | Ongoing list/inventory scans and delete work; costs grow with object count and scan frequency. | Not from inventory alone: an object can commit after the last scan. It avoids permanent untracking only if attempt records or repeated authoritative inventories remain available and writers are fenced/settled. | Establish inventory completeness and consistency, writer termination/fencing, and a post-termination sweep/verification rule. A final scan while PUTs may still be active is not enough. |

These are candidates for further evidence and human architecture review; this table does not select one. The observed per-attempt-key simulator corresponds most closely to Option 1 during UNKNOWN. B07 shows recovery of one deliberately delayed write, not a universal settlement bound or proof that indefinite reconciliation is operationally acceptable.

## Decision requested

For a later production design review, choose which unresolved condition should govern the next proof/design step:

1. Evaluate the metadata and worker costs of retaining/reconciling UNKNOWN attempt records until authoritative settlement.
2. Require proof of a valid upper bound or an authoritative fencing/termination mechanism before allowing finite retirement.
3. Evaluate provider inventory as additional detection while retaining an independent writer-settlement requirement.

No option is approved for production by this POC. Keep PR #93 unaccepted and Issue #75 open until the evidence, source-document reconciliation, and recovery decision receive explicit human review.
