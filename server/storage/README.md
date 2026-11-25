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
