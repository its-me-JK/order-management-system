# Deployment runbook

This repository has two deployment modes:

- Local: separate API, worker, MySQL, Redis, and RabbitMQ containers.
- Public showcase: one Render web container runs the API and worker, with the
  statically exported web application served by the API. MySQL, Valkey, and
  RabbitMQ are managed externally.

The second mode is intentionally a showcase topology. Render does not offer a
free background-worker instance, so the API and worker share one container.
They still run as separate processes, and the container exits if either process
fails. A paid production deployment should split them into independently
scalable services.

## Local stack

Requirements: Docker with Compose v2.20 or newer.

Create local secrets once:

```bash
umask 077
mkdir -p .local/secrets
openssl rand -hex 32 > .local/secrets/mysql-app-password
openssl rand -hex 32 > .local/secrets/mysql-root-password
openssl rand -hex 32 > .local/secrets/redis-app-password
openssl rand -hex 32 > .local/secrets/rabbitmq-password
```

Start the complete stack:

```bash
docker compose up --detach --build --wait --wait-timeout 180
```

The migration container applies committed Prisma migrations before either
application process starts. The API then seeds showcase data when
`DEMO_SEED=true`, which is the Compose default.

Endpoints:

- Application: `http://localhost:3000`
- OpenAPI: `http://localhost:3000/docs`
- Liveness: `http://localhost:3000/health/live`
- Readiness: `http://localhost:3000/health/ready`
- RabbitMQ management: `http://localhost:15672` (user `oms_app`; password is
  in `.local/secrets/rabbitmq-password`)

Inspect or stop the stack:

```bash
docker compose ps
docker compose logs --follow api worker
docker compose down
```

`docker compose down` preserves MySQL and RabbitMQ volumes. Adding `--volumes`
permanently removes their local data.

## Zero-cost public showcase

The checked-in [Render Blueprint](../../render.yaml) uses a free web instance.
As of 25 August 2026, the following providers publish suitable free plans:

- [Render free web services](https://render.com/docs/free)
- [Aiven for MySQL free tier](https://aiven.io/docs/products/mysql/concepts/mysql-free-tier)
- [Aiven Valkey free plan](https://aiven.io/pricing/valkey)
- [CloudAMQP Little Lemur](https://www.cloudamqp.com/plans.html)

Do not upgrade any service or enable a paid add-on. Free-plan availability,
quotas, and terms can change; check each provider before creating the resource.
Render free services sleep after inactivity, so the first request can take
about a minute and the worker does not process the outbox while the container
is asleep. It drains pending events after wake-up.

### 1. Create managed dependencies

1. Create an Aiven free MySQL service. Record its host, port, database, user,
   password, service URI, and CA certificate.
2. Create an Aiven free Valkey service. Record its host, port, username,
   password, and CA certificate.
3. Create a CloudAMQP Little Lemur instance. Copy its TLS `amqps://` URL.

Keep these values in the provider dashboards or a password manager. Never add
them to this repository.

### 2. Create the Render Blueprint

1. Push the repository and make sure the GitHub Actions `CI` workflow passes on
   `master`.
2. In Render, choose **New > Blueprint**, connect this repository, and select
   `render.yaml`.
3. Keep the `free` plan selected and enter every value marked `sync: false`.

Use the following mapping:

| Render variable | Value |
| --- | --- |
| `DATABASE_HOST` | Aiven MySQL host |
| `DATABASE_PORT` | Aiven MySQL port |
| `DATABASE_NAME` | Aiven database name |
| `DATABASE_USER` | Aiven MySQL user |
| `DATABASE_PASSWORD` | Aiven MySQL password |
| `DATABASE_TLS_CA` | Full Aiven MySQL CA PEM, including BEGIN/END lines |
| `DATABASE_MIGRATION_URL` | Aiven MySQL service URI with TLS parameters; this credential must be allowed to run DDL |
| `REDIS_HOST` | Aiven Valkey host |
| `REDIS_PORT` | Aiven Valkey port |
| `REDIS_USERNAME` | Aiven Valkey username, commonly `default` |
| `REDIS_PASSWORD` | Aiven Valkey password |
| `REDIS_TLS_CA` | Full Aiven Valkey CA PEM, including BEGIN/END lines |
| `RABBITMQ_URL` | CloudAMQP TLS URL beginning with `amqps://` |

The image build creates the Next.js static export, API, worker, and generated
Prisma client. At container startup it deploys migrations, then starts both
runtime processes under the checked-in supervisor. Render publishes the API
and web application at one `onrender.com` URL and checks `/health/ready`.

### 3. Verify the deployment

Replace `<service>` with the Render-generated host:

```bash
curl --fail --show-error https://<service>.onrender.com/health/live
curl --fail --show-error https://<service>.onrender.com/health/ready
curl --fail --show-error https://<service>.onrender.com/api/v1/catalog/skus
```

Then open `https://<service>.onrender.com` and exercise registration, catalog,
inventory, order placement, payment processing, and notifications. Confirm in
the Render logs that the worker publishes and consumes the order events.

Run the same automated workflow used for local and CI verification:

```bash
OMS_BASE_URL=https://<service>.onrender.com pnpm smoke:showcase
```

Do not publish the URL as complete until this command passes.

The showcase seed creates these public demo identities:

- Customer: `customer@oms.local` / `Customer123!`
- Administrator: `admin@oms.local` / `Admin123!`

These are intentionally non-secret demo credentials. Never reuse them in a
real environment, and set `DEMO_SEED=false` outside a portfolio showcase.

## Deployment and rollback behavior

- Render deploys only after linked GitHub checks pass.
- Migrations run before either runtime starts and are safe to rerun.
- A failed migration prevents the new container from accepting traffic.
- Runtime shutdown forwards `SIGTERM` to both processes and allows 30 seconds
  for graceful completion.
- Application rollback uses Render's previous-deploy rollback. Database
  migrations are forward-only, so each schema change must remain compatible
  with the previous application release until rollout is complete.

## Common failures

- `Invalid runtime configuration`: compare all Blueprint variables with the
  table above. Multiline CA values must contain the complete PEM.
- Migration failure: verify `DATABASE_MIGRATION_URL` is a MySQL URL with TLS
  enabled and a user permitted to create and alter tables.
- Readiness `503`: the API cannot probe MySQL or Redis; inspect the Render
  event and application logs without printing credentials.
- Worker bootstrap failure: verify the CloudAMQP URL uses `amqps://` and has
  not been copied with surrounding quotes.
- Redis unavailable during login: verify the Aiven Valkey username, password,
  TLS host, and CA certificate.

## What remains manual

The repository is deployment-ready, but it cannot create a live public URL
without the owner's Render, Aiven, CloudAMQP, and Git provider accounts. The
actual URL and provider secrets are therefore deliberately not checked in.
