# Operations guide

## Local bootstrap

From the repository root:

```bash
corepack enable
pnpm install --frozen-lockfile
cp .env.example .env
mkdir -p .local/secrets
umask 077
openssl rand -hex 32 > .local/secrets/mysql-app-password
openssl rand -hex 32 > .local/secrets/mysql-root-password
openssl rand -hex 32 > .local/secrets/redis-app-password
openssl rand -hex 32 > .local/secrets/rabbitmq-password
pnpm infra:up
```

Compose starts the complete application. Its one-shot migration container applies committed migrations with the local root credential before API or worker startup. The API and worker use the restricted application account. Secret files under `.local/` are ignored by Git.

For hot reload, stop the Compose API and worker, leave MySQL/Redis/RabbitMQ running, and start the application processes from the host:

```bash
docker compose stop api worker
pnpm dev:api
pnpm dev:worker
pnpm dev:web
```

Before starting the host worker, set `RABBITMQ_URL` to the local `oms_app` user, the password in `.local/secrets/rabbitmq-password`, and vhost `oms`. Do not use the guest fallback against the Compose broker. Set `DEMO_SEED=true` only for local/showcase data. The API seed is idempotent and does not reset existing orders or inventory.

## Infrastructure commands

```bash
pnpm infra:status
pnpm infra:logs
pnpm infra:down
```

`pnpm infra:down` preserves the MySQL and RabbitMQ volumes. To intentionally erase local data, first verify that the Compose project is this repository, then run:

```bash
docker compose down --volumes
```

That deletion is irreversible unless the volume was backed up.

## Runtime configuration

Configuration is validated before either runtime accepts work. Do not put credentials in a URL committed to Git.

### API

| Variable group | Purpose |
| --- | --- |
| `NODE_ENV`, `DEPLOYMENT_ENVIRONMENT`, `PORT`, `LOG_LEVEL` | process and logging policy |
| `WEB_ORIGIN`, `WEB_STATIC_DIR` | local CORS allow-list and production static asset path |
| `DATABASE_*` | MySQL host, bounded pool/timeouts, exactly one password source, TLS |
| `REDIS_*` | Redis host, ACL user, bounded timeouts/queue, exactly one password source, TLS |
| `DEMO_SEED` | opt-in portfolio seed |

### Worker

| Variable | Default outside production | Purpose |
| --- | --- | --- |
| `RABBITMQ_URL` | `amqp://guest:guest@127.0.0.1:5672` | broker connection; use `amqps://` when hosted |
| `RABBITMQ_CONNECT_TIMEOUT_MS` | 5000 | connection deadline |
| `RABBITMQ_PREFETCH` | 10 | maximum unacknowledged deliveries per consumer channel |
| `OUTBOX_POLL_INTERVAL_MS` | 500 | idle poll interval |
| `OUTBOX_BATCH_SIZE` | 25 | records selected per poll |
| `OUTBOX_MAX_ATTEMPTS` | 10 | publication attempts retained before operator action |
| `OUTBOX_INITIAL_BACKOFF_MS` | 1000 | first publication retry delay |
| `OUTBOX_MAX_BACKOFF_MS` | 60000 | retry-delay cap |

The worker also needs the same `DATABASE_*` settings as the API.

### Secret sources

Database and Redis passwords accept either an environment value or a file path, never both. File-based secrets are convenient for Compose; hosted secret managers usually inject values directly.

Deployed environments require identity-verifying TLS for MySQL and Redis. Use `DATABASE_TLS_CA`/`REDIS_TLS_CA` or their file equivalents only when the provider uses a private CA. RabbitMQ should use an `amqps://` endpoint supplied by the provider.

## Database operations

```bash
pnpm db:schema:validate
pnpm db:generate
pnpm db:migrate:status
pnpm db:migrate:deploy
```

Create migrations only in a development database with a dedicated shadow database:

```bash
pnpm db:migrate:create
```

Deployment order:

1. back up or confirm provider point-in-time recovery;
2. run `prisma migrate deploy` once with migration credentials;
3. start/update API and worker with DML-only credentials;
4. verify readiness and one smoke workflow;
5. retain the previous image until rollback is understood.

Application startup must not silently mutate schema.

## Health and smoke checks

```bash
curl --fail http://localhost:3000/health/live
curl --fail http://localhost:3000/health/ready
curl --fail http://localhost:3000/api/v1/catalog/skus
```

- Liveness answers whether the API process is serving HTTP.
- Readiness probes MySQL and Redis. MySQL is the source of truth, and Redis is required to preserve fail-closed login throttling.
- RabbitMQ is not an API readiness dependency because committed event intent remains durable in the outbox during a broker outage.
- Worker and RabbitMQ health are observed through process state, structured worker logs, queue depth, and outbox age; a dedicated worker health endpoint is future work.

A release smoke test must:

1. load the web app;
2. log in with a showcase customer;
3. view an in-stock SKU;
4. submit one order with a fresh idempotency key;
5. observe payment leave PENDING;
6. see the resulting notification;
7. log in as admin, ship then deliver an authorized order;
8. verify no unpublished outbox row is stuck and dead-letter queues are empty.

## Logs and correlation

The API emits structured JSON through Pino. Use `X-Correlation-Id` from a Problem Details response to locate the request log. The worker emits one-line JSON events such as:

- `worker.started`
- `outbox.batch_published`
- `outbox.batch_failed`
- `worker.stopped`

Never log bearer tokens, refresh cookies, CSRF tokens, passwords, database URLs, broker URLs, or raw request bodies. Hosted log retention must be finite.

## Troubleshooting

### API exits during configuration

- Confirm exactly one of `DATABASE_PASSWORD` and `DATABASE_PASSWORD_FILE`.
- Confirm exactly one of `REDIS_PASSWORD` and `REDIS_PASSWORD_FILE`.
- Confirm secret files are readable from the repository base directory.
- Local development uses `DEPLOYMENT_ENVIRONMENT=local` and disabled TLS.
- A production Node environment must use `showcase`, `staging`, or `production` and verified database/Redis TLS.

### Login returns 503

Redis is unavailable or its ACL/credential does not match. Check:

```bash
docker compose logs redis
docker compose ps redis
```

Do not bypass throttling by changing the API to fail open. Restore Redis or explicitly change the security policy through an ADR.

### Order remains PENDING_PAYMENT

Check, in order:

1. worker process is running;
2. RabbitMQ connection/topology succeeds;
3. `outbox_events.published_at` for the order event;
4. payment queue depth and dead-letter queue;
5. worker logs for outbox or consumer failure;
6. `processed_messages` claim and payment/order state.

Do not manually mark an outbox row published before proving the corresponding RabbitMQ publish.

### Migration permission denied

The application user intentionally lacks DDL permissions. Local commands derive a root migration URL from the root password file. Hosted deployments must provide a separate `DATABASE_MIGRATION_URL` with schema-change rights.

## Zero-cost showcase deployment

The logical deployment consists of:

- one public HTTPS service serving the static web build and Nest API;
- one worker process;
- hosted MySQL;
- hosted Redis/Valkey with Redis protocol compatibility;
- hosted RabbitMQ;
- a migration step that runs before the new application image.

Provider selection may change as free tiers change. Do not encode provider-specific assumptions into business code. The deployment is accepted only when the repository contains reproducible build/runtime configuration and the hosted smoke test above passes.

Free services commonly sleep, impose connection caps, or delete inactive data. Configure very small pools/prefetch values, expect cold starts, keep demo data reproducible, and describe the URL as a showcase—not a production SLA.

Production beyond a portfolio would additionally require paid high availability, backups with restore drills, private networking, secret rotation, WAF/rate limiting, metrics/alerts, distributed tracing, vulnerability management, and an on-call process.

## Release and rollback

Release:

1. merge only a green `pnpm check` and integration workflow;
2. build immutable API/web/worker artifacts from the same commit;
3. apply backward-compatible migration;
4. deploy worker and API in the order required by event/schema compatibility;
5. run health and business smoke tests;
6. record the commit and public URL.

Rollback application code only when the new migration is backward compatible. Never reverse a data migration by guessing. If a message contract caused the failure, stop the affected consumer, preserve the queue, deploy a compatible consumer, and replay after verification.
