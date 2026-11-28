# Issue #77 File recovery validation

This report records implementation and local verification for the approved
Issue #77 recovery plan. The implementation is based on `master` baseline
`4b94f2cd8930da4d20fdfb7d50eb3492580fe8fe` and the approved recovery commits
through `b6ff9c0f07a851510f20981f8a2e9a4ddaab2044` on
`feature/77-file-recovery`. The final implementation commit is
`2fe3a9403f2c610f4c7c8ba765b4cafdcab42c09`; this report is committed
immediately after it.

## Scope and behavior

The File module now has durable, bounded recovery work for expiry, attempt
cleanup, and tombstone compaction. PostgreSQL discovery uses indexed due-time
queries and small bounded batches. Each candidate is claimed under the
existing file/attempt lock order, with expiring fencing leases and fresh
database-clock timestamps. Provider DELETE runs outside database
transactions. Retries persist bounded error codes and backoff deadlines;
UNKNOWN PUTs retain their unique object key until a DELETE acknowledgement is
durable and late writes are revisited. Parent metadata is compacted only when
every attempt locator and retained descriptor is cleared.

No File endpoint, File API, Note lifecycle, Task status model, generic work
table, or Trash callback was added. File has no Note dependency. The worker
does not promise immediate deletion, backup erasure, or a finite cleanup time
for UNKNOWN writes.

## Verification evidence

Environment: Java 25.0.4, Maven wrapper, Docker 29.9.2, PostgreSQL 17.11,
Node 24.21.0, npm 11.19.0. Spring Boot remains at 4.0.10 per the approved
implementation decision. Real provider checks used the exact pinned image
`ghcr.io/chrislusf/seaweedfs:4.54@sha256:e7d4b80af9bd49b2630a60ac6fbb7ffb620ac6a2c501f689c22a71b9f89f0203`.

| Command | Result |
| --- | --- |
| `server/./mvnw -Duser.timezone=UTC test` | Passed: 532 tests, 0 failures, 0 errors, 0 skipped. |
| `server/./mvnw -B -ntp verify dependency:build-classpath -DincludeScope=test -Dmdep.outputFile=target/sonar-test-classpath.txt` | Passed: same 532 tests; SpotBugs 0 findings; JaCoCo XML validation passed; classpath generated. JaCoCo XML, classpath, and compiled main/test classes are nonempty/present. |
| `client/npm ci --legacy-peer-deps --ignore-scripts` | Passed. |
| `client/npm run verify` | Passed: ESLint (3 existing warnings, 0 errors), Prettier, Vitest coverage, production build, and coverage assertions. `coverage/lcov.info` is nonempty and measured. |
| `client/npm run test:e2e:install` | Could not install OS dependencies because the script invokes `sudo`, which this container disallows (`no new privileges`). Playwright Chromium was already installed in the environment. |
| `client/npm run test:e2e` with local loopback binding allowed | Passed: 105 Playwright tests. The sandbox initially denied Vite's `127.0.0.1:5173` bind; the same command passed after the required local-network sandbox escalation. |
| `git diff --check` | Passed. |

The failed first backend full-test run reported one error because the new
unversioned-bucket assertion queried a bucket before creating it. The test now
creates the bucket first; the focused S3 suite passed 8/8 and both subsequent
full backend runs passed 532/532.

## Recovery and provider proof

- PostgreSQL integration coverage verifies migration on empty databases and
  persistence across actual application restarts. The real application and
  SeaweedFS are stopped and restarted against the same database and object
  volume; recovery reclaims an expired lease, replays DELETE idempotently,
  completes cleanup after a provider outage, and preserves an unsettled
  locator until it can be revisited.
- Real SeaweedFS integration coverage uses the production S3 adapter. It
  checks that the bucket starts unversioned, writes and reads an object,
  deletes it, observes the object missing, and finds no object version or
  delete marker. An existing provider test also verifies unsigned reads are
  denied. The late-PUT fault test is repeated three times: a real recovery
  worker deletes before the held PUT completes, records the acknowledgement
  as uncertain because the write was unsettled at claim time, retains the
  locator, then deletes the late object after PUT settlement and confirms
  cleanup.
- Scheduler, database-clock, lock/lease, retry and observability integration
  suites pass in the full Maven run. Metrics use bounded error/outcome tags;
  tests check that owner/file/key/error text is not logged or exported and
  recovery adds no public management endpoint.
- The #75 POC cases A11–A15 and B01–B10 are treated as fault scenarios and
  acceptance prompts, not production proof. This branch's actual worker,
  PostgreSQL lease/locator persistence, restart test, and real-provider late
  PUT test provide the production-path evidence listed above. No POC-only
  simulation is represented as proof of deployment configuration.

## Deployment gate and limitations

Repository inspection found local Compose and test configuration but no
production deployment manifest or authenticated production bucket access.
The local provider fixture proves the pinned SeaweedFS behavior only. It does
not prove that the actual deployment bucket is private, has never been
versioned, has Object Lock/retention disabled, or has no replication/provider
policy that retains deleted data. Nor can the repository test verify the
separately operated deployment's bootstrap credentials and health checks.
Those are R5 release prerequisites. They remain unknown, so the implementation
must not be approved for merge or deployment until an operator supplies
read-only configuration evidence and completes an authenticated disposable
object write/read/delete check against the actual bucket.

No PR or issue comment has been created while this release gate is unknown.
The branch's Actions workflow runs backend, frontend, Playwright and SonarCloud
for pull requests targeting `master`; a feature-branch push by itself cannot
provide those hosted results. Hosted checks and the SonarCloud quality gate
therefore remain pending until the deployment evidence allows a PR.

UNKNOWN writes can remain unresolved indefinitely if a provider keeps
accepting late writes or cannot provide a conclusive outcome. Their key and
minimal recovery identity are deliberately retained; there is no finite
UNKNOWN retention or erasure guarantee. This worker does not integrate with
Trash. Issue #78, Issue #79, and Epic #9 remain responsible for Note UI/routes,
duplicate inline references, and parent permanent-deletion integration.

See [the File recovery runbook](../FILE-RECOVERY-RUNBOOK.md) for operator
signals, database inspection, retry behavior, and escalation guidance.
