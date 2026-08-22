# Distributed Order Management System

A production-oriented Order Management System for studying and demonstrating
reliable commerce workflows: inventory reservation, order orchestration,
payments, fulfillment, and asynchronous processing.

The system starts as a modular monolith. Notification and Payment may be
extracted into independent services only when operational evidence justifies
the additional distributed-systems cost.

## Project status

**Milestone 2 — platform and persistence foundation (in progress).** The API
now has a versioned public HTTP surface, unversioned operational health
endpoints, validated database configuration, a Prisma-private database
boundary, bounded readiness probes, application-owned database shutdown,
server-owned request identities, and sanitized structured JSON logging.
No business models, business modules, migrations, or public feature endpoints
have been implemented yet.

**Overall project progress: 17%.** The fixed, deployment-inclusive scoring
model and evidence are maintained in [Project progress](docs/progress.md).

## Planned technology

- Node.js, NestJS, and TypeScript
- Prisma and MySQL
- Redis
- RabbitMQ
- Docker and Docker Compose
- GitHub Actions
- Next.js, Tailwind CSS, shadcn/ui, React Query, and Zustand for the later web
  application
- Kubernetes and AWS after the backend and its operational model are mature

Technology choices do not override domain boundaries: framework, persistence,
cache, and messaging details stay behind application ports.

## Architecture at a glance

The initial repository will contain two deployable processes backed by one
modular codebase:

- **API:** synchronous REST endpoints, authentication, and verified webhooks.
- **Worker:** outbox publishing, message consumption, scheduled reservation
  expiry, retries, and notification delivery.

MySQL is the source of truth. Redis is an optional acceleration layer.
RabbitMQ carries durable integration events using at-least-once delivery, and
consumers are idempotent.

The initial business modules are Identity and Access, Customers, Catalog,
Pricing, Inventory, Orders, Payments, Fulfillment, Notifications,
Integrations, and Audit.

See the [architecture overview](docs/architecture/overview.md) for system
boundaries, runtime topology, consistency rules, and delivery sequence.
The [operational health contract](docs/architecture/operational-health.md)
documents probe behavior, failure semantics, alternatives, and trade-offs.
The [request identity and structured logging contract](docs/architecture/request-identity-and-logging.md)
defines header trust, log fields, redaction, and propagation boundaries.

## Architecture decisions

Significant decisions are recorded as Architecture Decision Records (ADRs):

- [ADR-0001: Start with a modular monolith](docs/adr/0001-modular-monolith.md)
- [ADR-0002: Separate API and worker runtimes](docs/adr/0002-api-and-worker-runtimes.md)
- [ADR-0003: Keep inventory correctness in MySQL](docs/adr/0003-inventory-consistency.md)
- [ADR-0004: Use a transactional outbox for integration events](docs/adr/0004-transactional-outbox.md)
- [ADR-0005: Use a native pnpm workspace](docs/adr/0005-pnpm-workspace.md)
- [ADR-0006: Centralize persistence infrastructure without surrendering module ownership](docs/adr/0006-persistence-boundaries.md)
- [ADR-0007: Keep development and demonstration infrastructure at zero cost (superseded)](docs/adr/0007-zero-cost-development.md)
- [ADR-0008: Operate a zero-cost public showcase environment](docs/adr/0008-zero-cost-public-showcase.md)
- [ADR-0009: Validate runtime configuration at process boundaries](docs/adr/0009-validate-runtime-configuration-at-boundaries.md)

The [ADR index](docs/adr/README.md) explains the lifecycle and format of these
records.

## Engineering principles

- Business invariants are enforced in the domain and application layers, not
  in controllers.
- Modules own their data and do not read another module's tables directly.
- External side effects never occur inside a database transaction.
- Public commands that may be retried are idempotent.
- Inventory, payment, and fulfillment use explicit state transitions.
- Observability, security, migrations, and failure recovery are part of a
  feature's definition of done.
- The `master` branch remains releasable.

## Delivery sequence

1. Architecture and engineering foundation
2. Platform and persistence foundation
3. Identity, catalog, pricing, and inventory
4. Order placement and cancellation
5. Payments and reliable messaging
6. Fulfillment and notifications
7. Operational hardening and portfolio-quality release

Detailed milestones and exit criteria are maintained in the
[architecture overview](docs/architecture/overview.md#delivery-roadmap).

## Local development

Prerequisites:

- Node.js `24.18.1`, as pinned in `.node-version`.
- pnpm `11.18.0`, as pinned in the root `packageManager` field.
- Docker Engine and Docker Compose `2.20` or newer.

This repository currently provisions no cloud resources. Local dependencies
use open-source containers, and standard GitHub-hosted Actions runners are free
for this public repository. A no-card public showcase environment is approved
but will not be provisioned until it has a meaningful, secure vertical slice.
The AWS topology remains a future design, not a running environment.

Create local-only password files and start MySQL:

```bash
test -f .env || cp .env.example .env
mkdir -p .local/secrets
umask 077
openssl rand -hex 32 > .local/secrets/mysql-app-password
openssl rand -hex 32 > .local/secrets/mysql-root-password
docker compose config --quiet
pnpm infra:up
pnpm infra:status
```

MySQL listens only on `127.0.0.1:3306`. If that port is occupied, change
`DATABASE_PORT` in `.env`. Local passwords and `.env` are ignored by Git.

Stop MySQL without deleting its data:

```bash
pnpm infra:down
```

The `mysql_data` volume survives ordinary shutdowns. Changing the configured
database name, user, or password does not reinitialize an existing volume.
`docker compose down --volumes` permanently deletes local database data and is
therefore intentionally not wrapped in a convenience script.

Install dependencies and run the complete local quality gate:

```bash
pnpm install --frozen-lockfile
pnpm check
```

Validate the persistence toolchain against local MySQL:

```bash
pnpm db:schema:validate
pnpm db:migrate:deploy
pnpm test:integration:database
```

The database package owns Prisma generation and the single ordered migration
history. The schema is intentionally model-free until the first business
module owns real state, so there is no synthetic baseline migration. Generated
Prisma code is local build output and is not committed.

For local migration commands, Prisma reads the root password from the ignored
secret file. Runtime integration uses the restricted `oms_app` principal.
Shared deployment environments must inject `DATABASE_MIGRATION_URL` through
their secret mechanism and use a separate DDL-capable migration principal.
Applications never apply migrations during startup.

Runtime database settings use the `DATABASE_*` namespace documented in
`.env.example`. A runtime receives exactly one of `DATABASE_PASSWORD` or
`DATABASE_PASSWORD_FILE`; migration URLs are never part of its configuration.
Production and showcase configuration requires `DATABASE_TLS_MODE` to be
`verify-identity`. The only supported TLS behavior verifies the server
certificate and hostname; there is no certificate-bypass option.

Create a migration only after adding and reviewing a module-owned schema
change:

```bash
pnpm db:migrate:create --name <migration_name>
pnpm db:migrate:dev
```

`db:migrate:create` generates SQL without applying it. Review that SQL before
running `db:migrate:dev` or committing it. `prisma db push` is deliberately not
exposed because it bypasses the reviewed migration history.

Start the API in watch mode:

```bash
pnpm dev:api
```

The API listens on port `3000` by default. Set `PORT` to a canonical integer
from `1` through `65535` to override it. `NODE_ENV` accepts `development`,
`test`, or `production` and defaults to `development`. `LOG_LEVEL` accepts
`fatal`, `error`, `warn`, `info`, `debug`, `trace`, or `silent`; its default is
runtime-aware. A production runtime must explicitly label
`DEPLOYMENT_ENVIRONMENT` as `local`, `test`, `showcase`, `staging`, or
`production`. Invalid runtime configuration stops bootstrap before the API
binds a socket and produces only a sanitized structured fatal record.

The API exposes operational endpoints independently of the versioned business
API:

| Endpoint | Meaning | Dependency behavior |
| --- | --- | --- |
| `GET /health/live` | The API process can handle HTTP requests | Does not probe MySQL or optional infrastructure |
| `GET /health/ready` | The API can safely receive application traffic | Performs a bounded MySQL connectivity probe |

Successful probes return HTTP `200`; failed or timed-out readiness probes
return HTTP `503`. Responses disable caching and disclose only dependency
status, never connection details or underlying errors. Business endpoints use
`/api/v1`; health endpoints deliberately remain unversioned.

```bash
curl --fail http://localhost:3000/health/live
curl --fail http://localhost:3000/health/ready
```

During database outages the process remains live while readiness returns
`503`, allowing an orchestrator to remove it from traffic without creating a
restart loop.

Every admitted API and health response includes a fresh server-owned
`X-Request-Id` and a validated `X-Correlation-Id`. Clients may supply one
canonical UUIDv4 or UUIDv7 correlation ID; invalid values safely fall back to
the request ID. Inbound request IDs are always ignored.

The API writes newline-delimited JSON logs to standard output. Access logs use
route templates and never include raw URLs, queries, bodies, credentials,
cookies, IP addresses, or raw exceptions. Successful health polls are silent;
failed readiness is a sanitized warning. See the
[logging contract](docs/architecture/request-identity-and-logging.md) before
adding diagnostic events.

The worker is buildable and its composition root is tested, but it has no run
script yet. An empty worker has no legitimate long-lived workload; a RabbitMQ
consumer, scheduler, or fake heartbeat will not be introduced merely to keep a
process alive.

Useful repository commands:

| Command | Purpose |
| --- | --- |
| `pnpm audit:dependencies` | Fail on known high or critical production dependency vulnerabilities |
| `pnpm build` | Build every workspace project |
| `pnpm build:api` | Build the API and its workspace dependencies |
| `pnpm typecheck` | Run strict TypeScript checks |
| `pnpm lint` | Run type-aware ESLint with zero warnings allowed |
| `pnpm test` | Run the Jest test suite |
| `pnpm test:coverage` | Generate local coverage output |
| `pnpm test:integration:api` | Verify API health and database-backed readiness against real MySQL |
| `pnpm format:check` | Verify formatting without modifying files |
| `pnpm check` | Run every required quality gate in CI order |
| `pnpm db:generate` | Generate the pinned Prisma client locally |
| `pnpm db:schema:validate` | Validate the complete multi-file Prisma schema |
| `pnpm db:migrate:create --name <name>` | Generate a reviewable migration without applying it |
| `pnpm db:migrate:dev` | Apply local development migrations |
| `pnpm db:migrate:deploy` | Apply committed migrations without creating new ones |
| `pnpm db:migrate:status` | Compare committed migrations with the database |
| `pnpm test:integration:database` | Verify Prisma and the database contract against real MySQL |
| `pnpm infra:up` | Start local dependencies and wait for health checks |
| `pnpm infra:down` | Stop local dependencies while preserving their data |
| `pnpm infra:status` | Show local dependency status |
| `pnpm infra:logs` | Follow local dependency logs |

## License

This project is available under the [MIT License](LICENSE).
