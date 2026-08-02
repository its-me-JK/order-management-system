# Distributed Order Management System

A production-oriented Order Management System for studying and demonstrating
reliable commerce workflows: inventory reservation, order orchestration,
payments, fulfillment, and asynchronous processing.

The system starts as a modular monolith. Notification and Payment may be
extracted into independent services only when operational evidence justifies
the additional distributed-systems cost.

## Project status

**Engineering foundation.** The architecture decisions, pinned workspace
toolchain, API composition root, worker composition root, automated tests, and
CI quality gate are in place. No business modules or public feature endpoints
have been implemented yet.

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

Install dependencies and run the complete local quality gate:

```bash
pnpm install --frozen-lockfile
pnpm check
```

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

## License

This project is available under the [MIT License](LICENSE).
