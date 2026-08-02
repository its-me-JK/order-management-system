# ADR-0006: Centralize persistence infrastructure without surrendering module ownership

- **Status:** Accepted
- **Date:** 2026-08-02

## Context

The modular monolith needs atomic order placement across Orders, Inventory,
Idempotency, and the outbox. It also needs module data ownership and a domain
model that is independent of Prisma. Separate database clients or schemas per
module make a local transaction harder, while unrestricted access to one
generated client turns logical boundaries into conventions only.

Identifier representation, transaction propagation, schema organization, and
migration ownership must be decided before the first database migration.

## Decision

Use one MySQL 8.4 LTS database and one generated Prisma client per runtime. The
database package owns connection lifecycle, Prisma generation, transaction
adaptation, and migrations; it does not own business repositories or expose a
generic repository abstraction.

### Schema and repository ownership

- Organize the Prisma schema as multiple files, with one model file per
  business module plus generator and datasource configuration.
- Maintain one ordered migration history for the physical database.
- Keep each module's repository interfaces in its application layer and Prisma
  implementations in its infrastructure layer.
- Only infrastructure adapters and the database composition root may import
  the generated Prisma client. Domain and application types never expose
  Prisma models, `Decimal`, transactions, or errors.
- Infrastructure mappers explicitly convert persistence records to domain
  objects and translate expected database errors to stable application errors.
- A module cannot query another module's model merely because the generated
  client makes it technically possible. Architecture tests and code review
  enforce ownership.

Foreign keys are allowed across module-owned tables when they protect a durable
referential invariant. Cross-module cascading deletes are prohibited. A
cross-module relation does not authorize relation traversal by another
module's repository, and extraction later uses an expand-and-contract
migration to replace the constraint.

### Unit of work

The application layer defines an explicit `UnitOfWork` port. Its callback
receives an opaque transaction scope with no query methods and no Prisma type.
An orchestrating use case passes that scope to narrow module application ports
participating in the same atomic operation. Each infrastructure adapter uses
the scope to resolve the transaction-bound Prisma client.

The scope is valid only for the awaited lifetime of its callback. The adapter
rejects an expired scope, does not silently create nested transactions or
savepoints, and does not allow callbacks to return lazy or detached work.
Standalone module commands own their transaction; only an explicit
orchestrating use case coordinates multiple modules.

Do not use an ambient AsyncLocalStorage transaction as the primary contract:
hidden transaction participation makes call paths, tests, and nested behavior
harder to reason about. Do not pass `Prisma.TransactionClient` through
application or domain APIs.

Transactions are short, contain no network calls, and have explicit timeouts.
Business write transactions initially use `READ COMMITTED` together with
conditional updates, unique constraints, optimistic versions, and locking
reads where a specific invariant requires them. A stricter isolation level is
selected per use case only after its anomaly and contention trade-offs are
documented.

Mutation order is deterministic when a command touches multiple stock rows,
using `(warehouse_id, sku_id)` ordering. Decisions immediately preceding a
mutation read from the primary database. Outbox claim work uses short claim
transactions and `SKIP LOCKED` through reviewed module-owned SQL if the Prisma
query surface cannot express the required locking behavior.

Deadlocks and lock timeouts are expected concurrency outcomes. The application
may retry the complete transaction a small, bounded number of times with
jitter only when the operation is idempotent and the database error is known to
be transient.

### Identifiers

Use application-generated UUIDv7 identifiers:

- Domain objects, API contracts, logs, and events use the canonical lowercase
  UUID string.
- MySQL stores identifiers as `BINARY(16)` in natural UUID byte order.
- Infrastructure mappers perform string/byte conversion at the persistence
  boundary.
- Prisma `Bytes`/`Uint8Array` values never leave infrastructure.
- Identifier generation is exposed through an application port so tests can
  provide deterministic IDs.
- External provider identifiers remain provider-scoped strings.
- Cursor pagination uses an explicit stable pair such as `(created_at, id)`;
  UUID ordering alone is not a pagination contract.

UUIDv7 keeps globally unique, time-ordered IDs while avoiding the larger
indexes and collation concerns of text ULIDs. Binary storage is less convenient
for ad hoc SQL, so operational documentation must include safe conversion
queries.

### Migrations

- Prisma migration SQL is generated locally, reviewed, and committed.
- Prisma CLI and Client use the same exact pinned version.
- `prisma migrate deploy` is the only application of committed migrations in
  shared and production environments.
- `prisma db push` is prohibited outside disposable local experiments.
- One deployment migration job runs before new application replicas become
  ready; application replicas do not race to migrate on startup.
- Schema changes follow expand, migrate/backfill, switch, and contract across
  releases when old and new application versions may overlap.
- Destructive changes, table rewrites, long locks, and data backfills require a
  rollout and rollback plan. Backfills are operational jobs, not an
  unbounded migration transaction.
- Raw reviewed SQL supplements Prisma migrations for constraints or indexes
  Prisma cannot express safely.
- All business tables use InnoDB. Database sessions use UTC, strict SQL mode,
  and deliberately selected collations; case-sensitive provider IDs and
  business codes use a binary collation.

### Testing and operations

- Repository, migration, transaction, and concurrency tests run against the
  same MySQL major line as production, not SQLite or an in-memory substitute.
- CI verifies migration application from an empty database and from the prior
  released schema.
- Concurrency coverage includes the last stock unit, reversed multi-line stock
  mutation order, optimistic conflicts, duplicate message claims, bounded
  deadlock retries, and full rollback across order, reservation, idempotency,
  history, and outbox records.
- Pool size is budgeted across all API and worker replicas; each process owns a
  bounded client lifecycle.
- Metrics cover pool saturation, query and transaction latency, deadlocks,
  lock waits, migration duration, and retry exhaustion.

## Consequences

### Positive

- Atomic multi-module workflows remain possible without leaking Prisma into
  business logic.
- Binary UUIDv7 keys keep primary and secondary indexes smaller than text IDs.
- One client and migration chain reduce connection and deployment complexity.
- Explicit transaction participation is visible and testable.
- Real MySQL tests cover the behavior the correctness model depends on.

### Negative

- Generated Prisma types still contain every model, so ownership needs
  automated enforcement.
- Explicit transaction scope propagation adds parameters to coordinated
  application calls.
- Binary identifiers make manual SQL less readable and require conversion
  tooling.
- Cross-module foreign keys and one migration history require work during
  service extraction.
- `READ COMMITTED` does not provide a repeatable snapshot; each invariant must
  use an appropriate conditional mutation, version, unique constraint, or
  lock rather than assuming repeated reads remain identical.

## Alternatives considered

- **One Prisma client per module:** strengthens visual ownership but duplicates
  pools and makes atomic cross-module transactions awkward.
- **Expose Prisma as the repository API:** reduces mapping code but couples
  business logic, errors, and tests to persistence records.
- **Ambient transaction context:** makes signatures smaller but hides the
  transaction boundary and complicates nested or concurrent execution.
- **ULID in `CHAR(26)`:** is human-friendly and sortable but consumes larger
  indexes and requires an explicit binary collation.
- **UUID strings in `CHAR(36)`:** are operationally convenient but impose the
  largest key and secondary-index cost of the considered identifiers.
- **Database auto-increment IDs:** are compact but complicate offline creation,
  event identity, data movement, and future service extraction.
- **Separate databases immediately:** provides physical isolation but gives up
  the local transaction before distributed workflow complexity is justified.
- **Global `SERIALIZABLE`:** prevents more anomalies but imposes avoidable
  locking, deadlocks, and throughput cost on use cases with narrower
  invariants.

## Revisit when

Revisit physical database separation when a module is approved for service
extraction or requires independent compliance, scaling, or recovery. Revisit
the unit-of-work adapter if Prisma gains a safer first-class transaction
context mechanism, but preserve explicit application-layer transaction
ownership.

## References

- [Prisma schema organization](https://docs.prisma.io/docs/orm/prisma-schema/overview)
- [Prisma MySQL type mappings](https://docs.prisma.io/docs/orm/core-concepts/supported-databases/mysql)
- [Prisma transaction options](https://docs.prisma.io/docs/orm/reference/prisma-client-reference)
- [MySQL LTS release model](https://dev.mysql.com/doc/refman/8.4/en/mysql-releases.html)
- [MySQL transaction isolation](https://dev.mysql.com/doc/refman/8.4/en/set-transaction.html)
- [InnoDB locking reads](https://dev.mysql.com/doc/refman/8.4/en/innodb-locking-reads.html)
