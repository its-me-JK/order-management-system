# ADR-0013: Model Catalog Products and SKUs separately

- **Status:** Accepted
- **Date:** 2026-08-22

## Context

The first business persistence slice needs a public catalog read model without
prematurely coupling merchandising identity to inventory, pricing, transport,
or an ORM. A Product describes what is sold; an SKU identifies an independently
stocked variation. Treating them as one record makes future variant lifecycle,
inventory references, and order snapshots ambiguous.

Public catalog traversal also needs stable pagination. MySQL stores the chosen
timestamps at microsecond precision, while JavaScript `Date` preserves only
milliseconds. Allowing that conversion in a cursor can skip or duplicate rows
created within the same millisecond.

## Decision

Catalog owns separate Product and SKU persistence records and an
application-owned, read-only repository contract.

- Product lifecycle is `DRAFT -> ACTIVE -> ARCHIVED`. Archived Products are
  retained; Catalog does not hard-delete them.
- SKU lifecycle is `DRAFT -> ACTIVE -> RETIRED`, with `DRAFT -> RETIRED`
  permitted for a variation that must never be published. Retired SKUs are
  retained.
- Product and SKU are separate future aggregate roots. An SKU references
  exactly one Product, and the database prevents deleting that Product while
  an SKU references it.
- SKU codes are immutable business identifiers, globally unique within this
  single-tenant system, case-sensitive, and restricted to 3--64 uppercase
  ASCII letters, digits, periods, underscores, and hyphens.
- Application-generated UUIDv7 identifiers are canonical lowercase strings
  outside persistence and natural 16-byte values in MySQL `BINARY(16)` columns.
- Mutable records carry an optimistic version. Application code owns all
  lifecycle timestamps; implicit database or ORM update timestamps are not
  used.
- An SKU is publicly visible only while both it and its Product are `ACTIVE`.
  A visible SKU is not necessarily priced, in stock, deliverable, or
  orderable; those decisions belong to Pricing, Inventory, and order
  orchestration.
- The initial public projection contains only SKU identifier, code, and name,
  plus Product identifier and name. It does not expose persistence state or
  lifecycle timestamps.
- Public SKU lists use an exclusive, newest-first seek over
  `(created_at, id)`. The persistence cursor retains a canonical UTC timestamp
  with exactly six fractional digits and a UUIDv7 tie-breaker.
- Prisma remains behind the Catalog infrastructure adapter. Point lookup uses
  an explicit Prisma projection. List traversal uses one parameterized SQL
  query because the generated binary-field filter cannot express the required
  ordering comparison and the JavaScript date path cannot retain MySQL
  microseconds.
- MySQL is the source of truth. This slice introduces neither a Redis cache nor
  a RabbitMQ event: cache invalidation and integration events require real
  Catalog write use cases and transaction semantics first.

Database constraints provide a final guard for identifier format, supported
states, lifecycle timestamp consistency, nonblank names, version bounds,
uniqueness, and referential integrity. Domain models and application use cases
will still own transition policy; constraints are not a substitute for them.

## Consequences

### Positive

- Inventory and order records can reference a stable SKU without duplicating
  Product lifecycle or conflating a Product with one variation.
- Anonymous reads cannot accidentally publish a draft or retired SKU under an
  inactive Product.
- Seek pagination is deterministic and does not lose precision as the catalog
  grows or concurrent inserts occur.
- Public contracts remain independent of Prisma records and MySQL binary
  identifiers.
- Deferring cache and event infrastructure avoids invalidation or delivery
  rules with no authoritative write workflow.

### Negative

- Even the first read slice requires two tables, lifecycle constraints, a UUID
  mapper, and an explicit join.
- Global SKU-code uniqueness would be insufficient for a future multi-tenant
  marketplace and can make code reuse after retirement an explicit business
  decision.
- The lossless list query is intentionally lower-level than ordinary Prisma
  reads and therefore needs focused SQL-shape and real-MySQL tests.
- Database constraints validate reachable row shapes but cannot prove that
  every state transition followed the allowed path. Future write use cases
  need conditional updates and transition tests.
- A newest-first feed is stable behind its cursor but does not freeze a
  snapshot; newly activated or inserted rows can appear before a client's
  first-page position.

## Alternatives considered

- **One table per sellable item:** simpler initially, but collapses Product and
  SKU identity and makes variants, stock references, and independent lifecycle
  changes expensive to introduce later.
- **Product aggregate owns every SKU:** gives a single consistency boundary but
  can turn a large variant catalog into a hot, ever-growing aggregate. The
  chosen separate roots keep cross-record invariants explicit.
- **Offset pagination:** straightforward for small demos, but becomes slower
  and can skip or repeat entries under concurrent changes.
- **JavaScript `Date` cursor:** convenient with Prisma, but irreversibly drops
  half of the stored fractional precision.
- **Random UUIDv4 stored as text:** familiar and readable in SQL, but consumes
  larger indexes and has worse insertion locality than application-generated
  UUIDv7 stored as binary.
- **Add Redis immediately:** could reduce database reads, but introduces stale
  data and invalidation behavior before a write path or measured read pressure
  exists.

## Revisit when

Revisit global SKU-code scope if multi-tenancy is approved; aggregate
boundaries if measured invariants require atomic Product-and-SKU commands;
pagination if ranking or search replaces creation order; and caching after a
real read workload, expiry target, and invalidation owner exist. Preserve
lossless cursors and the rule that orderability is decided outside Catalog.
