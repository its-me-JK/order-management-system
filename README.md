# Distributed Order Management System

A production-oriented Order Management System for studying and demonstrating
reliable commerce workflows: inventory reservation, order orchestration,
payments, fulfillment, and asynchronous processing.

The system starts as a modular monolith. Notification and Payment may be
extracted into independent services only when operational evidence justifies
the additional distributed-systems cost.

## Project status

**Milestone 3 — identity, catalog, pricing, and inventory (in progress).** The API
now has a versioned public HTTP surface, unversioned operational health
endpoints, validated database configuration, one runtime-owned Prisma client
with an infrastructure-only access boundary, bounded readiness probes,
application-owned database shutdown, server-owned request identities,
sanitized structured JSON logging, and a secret-safe RFC 9457 HTTP error
boundary that includes parser failures. It publishes a deterministic OpenAPI
3.0.3 contract and local read-only Swagger UI, and rejects malformed DTOs
through one strict non-coercive validation policy. The first Catalog read
slice now owns separate Product and SKU records, lifecycle and integrity
constraints, lossless seek pagination, UUIDv7 binary mapping, an active-only
Prisma adapter, bounded application inputs, and framework-independent public
query use cases. Its anonymous list and detail endpoints publish an exact
active-only representation, opaque cursor pagination, fixed Problem Details,
and `no-store` responses. A real vertical integration suite exercises the
production NestJS composition through Prisma and isolated MySQL. Catalog still
has no write path, but its internal Product and SKU aggregates now enforce the
accepted reversible lifecycles, Unicode names, lossless timestamps, optimistic
versions, immutable transitions, and domain events. SKU ownership and code are
immutable, while cross-aggregate Product policy remains reserved for the later
transactional application service. Both aggregates remain deliberately
unwired until the required administrative security and transactional
foundations exist. Persistence now supports those lifecycle shapes through a
guarded forward-only migration with deterministic legacy backfill and a real
prior-schema upgrade test. The Identity/session architecture fixes the account
and database boundaries, split opaque credentials, strict same-site browser
policy, durable refresh rotation, and fail-closed Redis abuse controls. Its
first framework-independent package slice now enforces canonical Account
identity, lossless microsecond time, optimistic versions, immutable lifecycle
transitions, strict rehydration, retention tombstones, and PII-free domain
facts. Its separate PasswordAuthenticator aggregate now adds a strictly
bounded, redacting Argon2id PHC value, immutable failure/cooldown state,
attempt-100 disablement, pre-hash verification-basis race protection,
conditional verifier upgrade, and offline rebind transition. The package
now also owns a terminal Role aggregate with immutable authorization codes,
strict Unicode display labels, canonical bounded Permission sets, explicit
grant/revoke deltas, and auditable initial mappings. SessionFamily now owns
lossless idle/absolute deadlines, version-derived rotation reachability,
derived authentication state, first-cause terminal revocation, and a
versionless RefreshCredential child. A separate immutable AccessCredential now
records the exact refresh generation that issued it. Family creation and
successful rotation return one frozen, generation-matched refresh/access
bundle; replay still closes the family without inspecting or issuing access
state, and the six-field conditional-write basis remains credential-secret
free. The package's first public application contract is now a nominal,
immutable authenticated principal containing only opaque actor/session IDs and
the bounded current permission set. Its authority factory remains internal and
validates role-count evidence, so the runtime package root exports no
constructor. Its internal credential boundary now adds fixed-policy Node
CSPRNG/SHA-256 generation, a pre-transaction one-shot attempt that re-verifies
the exact wire-to-digest pair, a nominal SecurityEvent identifier, and
digest-only refresh discovery with authentic one-use tickets. Its internal
attempt-bound refresh workflow now produces scope- and decision-bound pending
transaction evidence without claiming commit or credential-delivery authority.
The unused Identity Prisma slice and reviewed migration persist Account,
SessionFamily, retained refresh lineage, and generation-bound access records
with database-enforced lifecycle, active-slot, and referential invariants.
Identity still exposes no resolver use case or route; the concrete locked store
and Unit of Work, committed completion, authority/event persistence, Argon2
adapter, password input policy, and Redis remain gated later slices. Pricing,
inventory, Redis caching, and integration events also remain separate later
slices.

**Overall project progress: 35%.** The fixed, deployment-inclusive scoring
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

MySQL is the source of truth. Redis is optional acceleration for safe read
paths but is a mandatory fail-closed abuse-decision dependency for future login
and refresh issuance; it never becomes session authority. RabbitMQ carries
durable integration events using at-least-once delivery, and consumers are
idempotent.

The initial business modules are Identity and Access, Customers, Catalog,
Pricing, Inventory, Orders, Payments, Fulfillment, Notifications,
Integrations, and Audit.

See the [architecture overview](docs/architecture/overview.md) for system
boundaries, runtime topology, consistency rules, and delivery sequence.
The [operational health contract](docs/architecture/operational-health.md)
documents probe behavior, failure semantics, alternatives, and trade-offs.
The [request identity and structured logging contract](docs/architecture/request-identity-and-logging.md)
defines header trust, log fields, redaction, and propagation boundaries.
The [HTTP error contract](docs/architecture/http-error-contract.md) defines RFC
9457 responses, safe exception mapping, parser limits, and the operational
health exception.
The [OpenAPI and transport validation contract](docs/architecture/openapi-and-transport-validation.md)
defines contract ownership, public documentation posture, operation IDs, and
strict DTO boundary rules.
The [Identity and session contract](docs/architecture/identity-and-session.md)
defines account and session boundaries, opaque credential transport, database
authority, Redis abuse controls, CSRF/CORS policy, and the gated authentication
HTTP surface.
The [public Catalog read contract](docs/architecture/catalog-public-reads.md)
defines application query boundaries, pagination, visibility, and the
anonymous HTTP representation.
The [Catalog administration contract](docs/architecture/catalog-administration.md)
defines the gated write-side lifecycle, permissions, idempotency, optimistic
concurrency, audit, and transaction semantics.

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
- [ADR-0010: Standardize public HTTP errors with RFC 9457](docs/adr/0010-standardize-http-errors-with-rfc-9457.md)
- [ADR-0011: Publish explicit OpenAPI and enforce strict transport validation](docs/adr/0011-publish-explicit-openapi-and-enforce-strict-transport-validation.md)
- [ADR-0012: Expose Prisma only as a runtime-owned infrastructure capability](docs/adr/0012-expose-prisma-only-as-an-infrastructure-capability.md)
- [ADR-0013: Model Catalog Products and SKUs separately](docs/adr/0013-model-catalog-products-and-skus-separately.md)
- [ADR-0014: Support staged and reversible Catalog publication](docs/adr/0014-support-staged-and-reversible-catalog-publication.md)
- [ADR-0015: Authenticate and authorize administrative APIs](docs/adr/0015-authenticate-and-authorize-administrative-apis.md)
- [ADR-0016: Make retryable commands durably idempotent](docs/adr/0016-make-retryable-commands-durably-idempotent.md)
- [ADR-0017: Use split browser session credentials](docs/adr/0017-use-split-browser-session-credentials.md)

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
pnpm test:integration:identity-refresh-lineage
pnpm test:integration:catalog
```

The database package owns Prisma generation and one ordered forward-only
migration history. Module-owned Prisma models compose into that schema; the
reviewed migrations create Catalog Product and SKU records, then safely expand
their lifecycle invariants, and add the currently unused Identity refresh
lineage. Generated Prisma code is local build output and is not committed. The
Identity verifier applies the complete migration history twice in dedicated
main and shadow databases, proves Prisma has no representable schema drift, and
adversarially checks the byte-exact codes, microseconds, foreign keys, issuance
witness, and one-active-refresh invariant against pinned MySQL. The Catalog
integration command verifies an initial-schema
upgrade with legacy rows, rejects ambiguous terminal history before DDL, and
also creates, migrates twice, and removes an exact fresh
`oms_catalog_integration` database. It verifies the repository contract and
production HTTP composition against real MySQL. It grants the application
principal only DML access while the suite runs and refuses an externally
supplied migration URL, so normal development and showcase data are never test
fixtures. The
[Catalog lifecycle recovery runbook](docs/runbooks/catalog-lifecycle-migration-recovery.md)
defines the fail-closed partial-DDL decision path.

Catalog UUIDv7 values use natural byte order, so operational SQL must keep the
MySQL swap flag disabled:

```sql
SELECT BIN_TO_UUID(id, 0) AS id FROM catalog_skus;
SELECT * FROM catalog_skus WHERE id = UUID_TO_BIN('01890f3a-8bcd-7def-8abc-0123456789ab', 0);
```

Using a swap flag of `1` would apply the legacy UUIDv1 byte rearrangement and
produce identifiers that do not match the application's UUIDv7 codec.

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

The first versioned business endpoints expose anonymous, active-only Catalog
reads:

| Endpoint | Meaning | Contract |
| --- | --- | --- |
| `GET /api/v1/catalog/skus` | List public SKUs | Optional canonical `limit` and opaque `cursor`; maximum page size 100 |
| `GET /api/v1/catalog/skus/{skuId}` | Get one public SKU | Lowercase UUIDv7; missing and non-public resources are indistinguishable |

Catalog responses use `Cache-Control: no-store` and never expose lifecycle,
persistence, price, inventory, or orderability fields. The list uses
forward-only keyset pagination; clients must treat `nextCursor` as opaque.

The same API process exposes its environment-neutral contract without a paid
documentation service:

| Endpoint | Meaning | Runtime behavior |
| --- | --- | --- |
| `GET /docs` | Read-only Swagger UI | Uses required local assets only; browser submission and remote validation are disabled |
| `GET /docs/openapi.json` | OpenAPI 3.0.3 JSON | Generated once at startup; does not probe MySQL or publish deployment hosts |

Documentation paths are unversioned and case-sensitive. Every representation
uses `Cache-Control: no-store` and the normal server-owned request identity.
Framework-default JSON/YAML aliases, package metadata, source maps, and OAuth
UI helpers are not public.

```bash
curl --fail http://localhost:3000/health/live
curl --fail http://localhost:3000/health/ready
curl --fail 'http://localhost:3000/api/v1/catalog/skus?limit=20'
curl --fail http://localhost:3000/docs/openapi.json
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

Public API failures use RFC 9457 Problem Details with fixed messages, opaque
occurrence IDs, matching request/correlation headers, and `Cache-Control:
no-store`. JSON request bodies are limited to 100 KiB; URL-encoded parsing is
disabled until a real endpoint requires it, and compressed request bodies are
rejected with `415`. The
[HTTP error contract](docs/architecture/http-error-contract.md) is the source of
truth for supported statuses and disclosure rules.

Feature request bodies must use concrete decorated DTO classes. Unknown
ordinary fields, missing required values, invalid nested shapes, and wrong
primitive types receive the same fixed RFC 9457 `400` response without field
names, rejected values, or constraint messages. The global boundary does not
implicitly convert client values; business invariants remain the responsibility
of application use cases and domain models.

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
| `pnpm test:integration:catalog` | Verify Catalog persistence and the production HTTP composition in an isolated local MySQL database |
| `pnpm test:integration:identity-refresh-lineage` | Verify the Identity lineage migration, invariants, and Prisma drift against isolated real MySQL databases |
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
