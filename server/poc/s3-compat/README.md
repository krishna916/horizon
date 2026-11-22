# Issue #75 isolated S3 compatibility proof

This is a disposable integration harness for the approved Issue #75 storage design. It must remain independent of `server/pom.xml`, `server/compose.yaml`, production source, and application database data.

## Pinned components

- SeaweedFS 4.54, pinned to `ghcr.io/chrislusf/seaweedfs@sha256:e7d4b80af9bd49b2630a60ac6fbb7ffb620ac6a2c501f689c22a71b9f89f0203` (linux/amd64 child manifest)
- AWS SDK for Java v2 2.59.2
- Testcontainers for Java 2.0.5
- Toxiproxy 2.13.0, pinned to `ghcr.io/shopify/toxiproxy@sha256:5d3dae09bc185dcc5ff6cf43abf6062a4a720aff0c4306a471e773acdcd107aa`

These exact pins were approved by the user on 2026-11-22. The standalone `pom.xml` owns its dependency versions. Run the complete A01–A16 harness with `./mvnw -f poc/s3-compat/pom.xml test`. Case outcomes and generated test object keys are recorded in `results/observations.md`; the summary and recovery proposal are in `results/REPORT.md` and `results/DECISION-OPTIONS.md`. B01–B10 use a disposable, digest-pinned PostgreSQL 17 Testcontainers instance; B11–B13 are explicitly test-only contract models. Credentials and bucket are test-only. No real filenames, user content, or application credentials belong here.

## Start and run

From `server/`:

```bash
cp poc/s3-compat/.env.example poc/s3-compat/.env
# Edit only the test-only values if needed.
export POC_S3_VOLUME=horizon-issue75-s3-compat-local
docker compose -f poc/s3-compat/compose.yaml up -d
./mvnw -f poc/s3-compat/pom.xml test
```

The service listens only on loopback port 8333. Tests use path-style S3 requests, endpoint overrides, explicit test-only credentials, and disabled SDK retries for fault attribution. A07 removes and recreates only the SeaweedFS container while retaining the named volume. A11–A15 use a one-request test-only TCP gate that records the request-body barrier and, for A12, observes the provider HTTP 200 before dropping the downstream response. Keep the published port private; do not run this stack on a shared/public host.

For each fresh clone, set and export `POC_S3_VOLUME` to a unique volume name before starting the service. Compose and the tests use that same named volume; it must remain intact through A07. The example value in `.env.example` is stable and will be reused until changed. Run this harness serially because Compose uses one fixed project and service name.

To reproduce the clean-checkout evidence, run the full suite and then repeat the controlled S3 failure class four times. This gives five A14 barriers total and 25 A15 conditional interleavings; each attempt appends its run ID, unique object keys, outcome and independent S3 read to `results/observations.md`:

```bash
for attempt in 1 2 3 4; do
  ./mvnw -f poc/s3-compat/pom.xml -Dtest=S3FailureTest test
done
```

## Persistence and teardown

A07 removes and recreates only the `seaweedfs` container and retains the configured POC volume. Preserve that exact volume until the persistence evidence is captured. After all POC results have been recorded, stop the service with:

```bash
docker compose -f poc/s3-compat/compose.yaml down
```

Only after the evidence is complete, remove this POC's dedicated volume with its exact configured name (the README command's example uses `horizon-issue75-s3-compat-local`; `.env.example` defaults to `horizon-issue75-s3-compat-data`):

```bash
docker volume rm "$POC_S3_VOLUME"
```

Never use `down -v` or remove any other volume. Do not point this fixture at the normal Horizon PostgreSQL database or a live object store.
