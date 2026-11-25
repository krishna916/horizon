# Local private object storage

The local development stack uses the same pinned SeaweedFS 4.54 image as the approved Issue #75 compatibility proof. It exposes S3 only on loopback, authenticates requests with the configured access key, creates the bucket named by `HORIZON_S3_BUCKET`, and stores data in the dedicated `HORIZON_S3_VOLUME` Docker volume.

Start the local S3 service from `server/`:

```bash
docker compose up -d seaweedfs
```

The safe local defaults are `horizon-local-access`, `horizon-local-secret-only`, bucket `horizon-files`, port `8333`, and volume `horizon-file-object-data`. These are development credentials only. Override them before starting the service when needed:

```bash
export AWS_ACCESS_KEY_ID='local-development-access'
export AWS_SECRET_ACCESS_KEY='local-development-secret'
export HORIZON_S3_BUCKET='horizon-files'
export HORIZON_S3_PORT='8333'
export HORIZON_S3_VOLUME='horizon-file-object-data'
docker compose up -d seaweedfs
```

The same `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` must be available to the Horizon application process. Configure the application's endpoint and path-style access for local use:

```bash
export HORIZON_S3_ENDPOINT='http://127.0.0.1:8333'
export HORIZON_S3_BUCKET='horizon-files'
export HORIZON_S3_PATH_STYLE_ACCESS='true'
```

The application reads credentials through the AWS SDK default credential chain. Cloud deployments should use the deployment's private S3-compatible bucket and workload credentials; do not deploy the local development credential defaults or expose the object endpoint publicly. Configure `HORIZON_S3_ENDPOINT` only for S3-compatible services that require an endpoint override. The default region is `us-east-1`.

`S3_BUCKET` is SeaweedFS's idempotent bucket bootstrap setting. The adapter never creates buckets or grants anonymous access. Requests must be signed; the integration test checks that an unsigned GET is denied. Keep the volume across container recreation when retaining local objects. Do not use `docker compose down -v` or remove the named volume as routine cleanup.

The PostgreSQL service and its existing `./database/postgres` bind mount are unchanged.

## Upload policy and capacity

The backend is authoritative for upload size and content validation. The default maximum is
**20,971,519 bytes inclusive**. Deployments may raise it through `HORIZON_FILE_MAX_FILE_SIZE`
or the equivalent `horizon.file.max-file-size` application property, up to the approved
**104,857,600 byte (100 MiB) inclusive ceiling**. For example, `HORIZON_FILE_MAX_FILE_SIZE=50MB`
sets 52,428,800 bytes. Invalid values above the ceiling fail application startup. A policy
change takes effect after restart; future API consumers must obtain the effective policy from
the backend capability service instead of copying the default into client code.

Every transfer requires a known positive content length and a matching SHA-256. The current
effective maximum applies to new and unverified transfers. A file already verified remains
valid if a deployment later lowers its maximum. This implementation does not impose an
aggregate per-user storage quota.

The default staging concurrency is four transfers with a 65,536-byte copy buffer. The default
payload staging budget is derived from the effective maximum multiplied by concurrency:
83,886,076 bytes at the default upload limit. `HORIZON_FILE_STAGING_MAX_TOTAL_SIZE` (or
`horizon.file.staging.max-total-size`) can set a different total, but it must fit at least one
maximum-size file. Temporary payload files are confined to the exclusive, private staging
directory selected by `HORIZON_FILE_STAGING_DIRECTORY`.

Parser scratch is accounted separately from staged payload. A validation may reserve up to
128 MiB of parser scratch; with four concurrent validations, the reserved scratch budget can
reach 512 MiB in addition to payload staging. Image decoding is bounded by configured
dimensions, pixel count, and frame limits; PDF page count, office archive entry/expanded-size
limits, and parser scratch limits are configured independently of the upload-size ceiling.
Provision disk and memory for these simultaneous budgets. A platform image decoder's CPU time
and process memory are not a full sandbox; run the approved amd64 SeaweedFS image on its
verified platform. The ARM64 image digest has not been verified.

## Deployment and recovery

For cloud deployment, provision a private S3-compatible bucket and workload credentials outside
this application. The application does not create buckets, grant ACLs, or expose object URLs.
Use the AWS SDK credential provider chain; do not use the local development credentials. Keep
the selected bucket and provider stable for existing files: changing either without a reviewed
data migration makes stored locators unreadable. Multipart and resumable uploads remain out of
scope.

The File module exports no HTTP endpoint in this release. Its authenticated read-only storage
health contributor checks bucket availability and reports only `UP` or a sanitized
`storage: unavailable` detail. A storage outage affects readiness/aggregate health, not the
application liveness state. Metrics are `horizon.file.transfer.duration`,
`horizon.file.transfer.outcomes`, `horizon.file.staging.active`, `horizon.file.staging.bytes`,
`horizon.file.validation.rejections`, and `horizon.file.storage.errors`. Their tags are limited
to transfer outcome or a fixed storage operation; they contain no user/file identifiers,
filenames, hashes, object keys, content, or credentials.

File cleanup currently records durable cleanup intent and prevents new reads; it does not
synchronously delete provider objects. There is no recovery worker in #76. An unresolved PUT
attempt stays recorded with its unique object locator, including after timeout, expiry, a
negative existence check, or a delete response. Do not manually remove objects or discard
attempt records to make this state appear settled.

The #77 recovery worker must preserve the workspace → File → attempt lock order and must retain
the attempt/file identity, object locator, outcome, creation/update times, and cleanup/expiry
state needed to reconcile attempts. It must never infer settlement from timeout or a negative
HEAD, and unresolved locators have no finite automatic retirement condition until an approved
recovery decision says otherwise. Worker scheduling, backoff/alert policy, and physical
compaction belong to #77.

Before a future caller such as Notes uses files, #78 must define capability discovery from the
backend, caller authorization and scope validation, atomic association with the caller's
transaction, and request-size handling. #76 does not add those routes or associations. The
approved #68 Notes UX workflow remains the product baseline.
