# File recovery runbook

The File recovery worker is enabled by default and polls every 30 seconds. It
uses bounded batches (25 rows by default), a database lease, and separate
transactions around database changes. Provider I/O runs outside database
transactions. Configure `HORIZON_FILE_RECOVERY_ENABLED=false` only to pause
recovery during an incident; restore it to `true` to resume. A process restart
does not discard queued work or lease state.

## Required object bucket behavior

The configured S3-compatible bucket must be private, unversioned, and must not
retain deleted objects through Object Lock, retention policies, replication, or
another provider feature. An acknowledged DELETE must make the current object
unreadable, and a later PUT to the same key must not expose an older version.
Use unique keys for every transfer attempt. Do not enable versioning or object
retention for this bucket.

The repository's local Compose service uses the pinned SeaweedFS image
`ghcr.io/chrislusf/seaweedfs:4.54@sha256:e7d4b80af9bd49b2630a60ac6fbb7ffb620ac6a2c501f689c22a71b9f89f0203`,
with a private, persistent local volume. The real-provider integration test
checks unversioned bucket behavior and verifies that DELETE removes the current
object without leaving a version or delete marker. This local evidence does
not certify a separately operated deployment. Before deploying, verify the
actual bucket configuration and authenticated write/read/delete behavior using
a disposable object; do not use customer data for that check.

## Signals

The recovery metrics are low-cardinality and contain no owner, file, object
key, filename, or provider error text:

| Metric | Meaning |
| --- | --- |
| `horizon.file.recovery.pending` | Total durable recovery work |
| `horizon.file.recovery.due` | Due work without a live lease |
| `horizon.file.recovery.overdue` | Unleased work past its due time |
| `horizon.file.recovery.unresolved` | Attempts whose write outcome is not durably settled |
| `horizon.file.recovery.active.leases` | Leases not yet expired |
| `horizon.file.recovery.expired.leases` | Leases available for reclamation |
| `horizon.file.recovery.oldest.unresolved.age.seconds` | Age of the oldest unsettled attempt |
| `horizon.file.recovery.last.success.epoch.seconds` | Database timestamp of the last completed poll |
| `horizon.file.recovery.cycle.duration` | Poll duration timer |
| `horizon.file.recovery.delete.outcomes{outcome}` | Delete completion disposition counter |
| `horizon.file.recovery.errors{error}` | Storage or database retry counter |
| `horizon.file.recovery.lease.reclaims` | Expired lease reclamation counter |

Alert on a stale last-success timestamp, growing overdue work, repeated storage
errors, and an unresolved count or oldest unresolved age that keeps increasing.
An UNKNOWN write is intentionally retained and revisited hourly after an
acknowledged delete. It can remain unresolved indefinitely if the provider
continues to accept late writes or never provides a conclusive result. There is
no finite UNKNOWN retention or erasure guarantee.
The worker does not promise immediate erasure, backup erasure, or a finite
cleanup time for an unresolved write.

## Database inspection

This aggregate query is read-only and reports counts only. Run it against the
application database when metric export is unavailable or needs confirmation:

```sql
SELECT
  count(*) FILTER (WHERE object_key IS NOT NULL AND write_settled_at IS NULL
                   AND outcome IN ('PENDING', 'UNKNOWN')) AS unresolved_attempts,
  count(*) FILTER (WHERE object_key IS NOT NULL AND cleanup_confirmed_at IS NULL) AS retained_keys,
  count(*) FILTER (WHERE cleanup_lease_token IS NOT NULL
                   AND cleanup_lease_until > clock_timestamp()) AS active_leases,
  count(*) FILTER (WHERE cleanup_lease_token IS NOT NULL
                   AND cleanup_lease_until <= clock_timestamp()) AS expired_leases
FROM file_transfer_attempt;
```

This second aggregate reports retry deadlines, backlog age, leases, and bounded
error categories without returning attempt identifiers or object metadata:

```sql
SELECT
  COALESCE(a.last_cleanup_error_code, 'NONE') AS safe_error_code,
  count(*) FILTER (WHERE a.object_key IS NOT NULL AND a.cleanup_confirmed_at IS NULL)
    AS retained_attempts,
  count(*) FILTER (WHERE a.object_key IS NOT NULL AND a.cleanup_confirmed_at IS NULL
                   AND f.purged_at IS NULL
                   AND CASE WHEN a.cleanup_requested_at IS NOT NULL
                            THEN COALESCE(a.next_cleanup_at, a.cleanup_requested_at)
                            ELSE a.created_at END
                       <= clock_timestamp()
                   AND (a.cleanup_lease_until IS NULL
                        OR a.cleanup_lease_until <= clock_timestamp())
                   AND (a.cleanup_requested_at IS NOT NULL
                        OR f.cleanup_requested_at IS NOT NULL
                        OR f.expiry_recorded_at IS NOT NULL
                        OR (f.claimed_at IS NULL AND f.expires_at <= clock_timestamp())
                        OR (f.selected_attempt_id IS NOT NULL
                            AND f.selected_attempt_id <> a.id)
                        OR (a.outcome = 'FAILED' AND a.write_settled_at IS NOT NULL))
                   AND (f.selected_attempt_id IS DISTINCT FROM a.id
                        OR f.cleanup_requested_at IS NOT NULL
                        OR f.expiry_recorded_at IS NOT NULL
                        OR (f.claimed_at IS NULL
                            AND f.expires_at <= clock_timestamp())))
    AS due_unleased_attempts,
  count(*) FILTER (WHERE a.cleanup_lease_token IS NOT NULL
                   AND a.cleanup_lease_until > clock_timestamp()) AS active_leases,
  count(*) FILTER (WHERE a.cleanup_lease_token IS NOT NULL
                   AND a.cleanup_lease_until <= clock_timestamp()) AS expired_leases,
  COALESCE(GREATEST(0, EXTRACT(EPOCH FROM
      (clock_timestamp() - min(a.created_at) FILTER
          (WHERE a.object_key IS NOT NULL AND a.write_settled_at IS NULL)))::bigint), 0)
    AS oldest_unsettled_age_seconds,
  min(a.next_cleanup_at) FILTER
      (WHERE a.object_key IS NOT NULL AND a.cleanup_confirmed_at IS NULL)
    AS earliest_retry_at
FROM file_transfer_attempt a
JOIN file_metadata f ON f.id = a.file_id
GROUP BY COALESCE(a.last_cleanup_error_code, 'NONE')
ORDER BY safe_error_code;
```

An expired lease may be reclaimed on the next poll; do not clear or extend it
manually. `next_cleanup_at` is the persisted retry deadline, while an
unsettled attempt acknowledged by DELETE is revisited after the configured
one-hour unknown interval. The bounded error code describes the most recent
failed DELETE attempt and is cleared after an acknowledged DELETE.

Do not manually clear a locator, mark cleanup confirmed, delete recovery rows,
or bypass the lease. The worker only compacts a parent after all attempt
locators and retained descriptors have been durably cleared. If recovery is
overdue, check application database availability, worker enablement, provider
readiness, and the bounded retry/error metrics. Resolve provider configuration
or availability and let the persisted backoff retry; preserve all unresolved
keys until the worker confirms each delete.

Recovery is independent of Note Trash/Archive/Restore behavior. There is no
automatic Trash cleanup. Product lifecycle integrations and user-facing file
recovery actions remain outside this worker.
