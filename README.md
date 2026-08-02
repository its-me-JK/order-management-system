# Distributed Order Management System

A production-oriented Order Management System for studying and demonstrating
reliable commerce workflows: inventory reservation, order orchestration,
payments, fulfillment, and asynchronous processing.

The system starts as a modular monolith. Notification and Payment may be
extracted into independent services only when operational evidence justifies
the additional distributed-systems cost.

## Project status

**Persistence foundation.** The architecture decisions, pinned workspace
toolchain, API and worker composition roots, local MySQL 8.4 environment,
Prisma database package, automated tests, and CI quality gates are in place.
No business models, business modules, migrations, or public feature endpoints
have been implemented yet.

**Overall project progress: 13%.** The fixed, deployment-inclusive scoring
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
mkdir -p .local/secrets
umask 077
openssl rand -hex 32 > .local/secrets/mysql-app-password
openssl rand -hex 32 > .local/secrets/mysql-root-password
docker compose config --quiet
pnpm infra:up
pnpm infra:status
```

MySQL listens only on `127.0.0.1:3306`. If that port is occupied, copy
`.env.example` to `.env` and change `MYSQL_PORT`. Local passwords and `.env` are
ignored by Git.

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

The API listens on port `3000` by default. Set `PORT` to a valid integer from
`1` through `65535` to override it. There are intentionally no controllers in
this scaffold, so an HTTP request returns the standard NestJS `404` response.

The worker is buildable and its composition root is tested, but it has no run
script yet. An empty worker has no legitimate long-lived workload; a RabbitMQ
consumer, scheduler, or fake heartbeat will not be introduced merely to keep a
process alive.

Useful repository commands:

| Command | Purpose |
| --- | --- |
| `pnpm build` | Build every workspace project |
| `pnpm typecheck` | Run strict TypeScript checks |
| `pnpm lint` | Run type-aware ESLint with zero warnings allowed |
| `pnpm test` | Run the Jest test suite |
| `pnpm test:coverage` | Generate local coverage output |
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
