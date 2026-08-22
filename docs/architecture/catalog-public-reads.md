# Public Catalog reads

## Scope

This contract defines the framework-independent Catalog query use cases and the
HTTP delivery boundary for public SKU reads. It does not define Catalog
writes, search, merchandising rank, pricing, inventory availability, Redis
caching, RabbitMQ events, or administrative access.

The persistence model and active-only visibility invariant remain owned by
[ADR-0013](../adr/0013-model-catalog-products-and-skus-separately.md).

## Application contract

Catalog exposes two query use cases without a CQRS framework:

- `GetPublicSku` accepts a canonical lowercase UUIDv7 SKU identifier and
  returns either `found` with the public projection or `not-found`.
- `ListPublicSkus` accepts an optional exclusive cursor and optional page size,
  then returns ordered public projections and an optional next cursor.

The application layer owns identifier, cursor-position, and page-size
validation. The default page size is 20 and the maximum is 100. Invalid input
is rejected before the repository is called. Repository results and failures
retain their application meaning; use cases do not translate them into HTTP or
database-specific errors.

The use cases are plain TypeScript classes. They depend only on the
application-owned `CatalogReadRepository` and contain no NestJS, Prisma, HTTP,
configuration, logging-vendor, Redis, or RabbitMQ imports.

## HTTP contract

The API delivery adapter publishes:

| Operation | Path | Success |
| --- | --- | --- |
| List public SKUs | `GET /api/v1/catalog/skus` | `200` collection envelope |
| Get a public SKU | `GET /api/v1/catalog/skus/{skuId}` | `200` resource envelope |

The list accepts exactly `limit` and `cursor` as optional query parameters.
`limit` uses canonical unsigned decimal syntax and must resolve to 1 through
100. `skuId` must be an exact lowercase UUIDv7. Unknown, repeated, ambiguous,
or noncanonical values are invalid; the transport performs no implicit
coercion.

Detail success has this shape:

```json
{
  "data": {
    "id": "01890f3a-8bcd-7def-8abc-0123456789ab",
    "code": "MILK-1L",
    "name": "Whole milk 1L",
    "product": {
      "id": "01890f3a-8bcd-7def-9abc-0123456789ab",
      "name": "Whole milk"
    }
  }
}
```

List success has this shape:

```json
{
  "data": [],
  "pageInfo": {
    "nextCursor": null
  }
}
```

Every member is required. An empty collection is `200`, not `204` or `404`.
The representation never exposes lifecycle state, timestamps, optimistic
version, persistence cursor fields, price, inventory, or orderability. There
is no total count, offset, page number, caller-selected sort, or host-derived
next URL.

## Cursor contract

The HTTP cursor is an unpadded base64url encoding of one canonical,
versioned payload with a maximum encoded length of 256 characters. Its
internal payload binds the token to the public-SKU list and retains the exact
six-digit UTC timestamp and UUIDv7 tie-breaker. Decoding requires exact shape,
version, types, scope, canonical re-encoding, timestamp, and identifier
validation. Every decode failure has the same safe invalid-cursor outcome.
Malformed client cursors become a fixed `400` response. Failures while encoding
an application-owned next position remain server failures and become the fixed
`500` response; they are never mislabeled as invalid client input.

The cursor is opaque but not secret. It is deliberately unsigned: changing a
position cannot widen access beyond the same indexed, active-only public query,
and the hard page-size limit bounds each request. HMAC signing would add secret
distribution, rotation, and startup failure modes without protecting an
authorization decision. Revisit signing when a cursor binds tenant,
authorization, filters, or expensive query state.

The cursor is exclusive and forward-only over descending `(created_at, id)`.
It does not create a snapshot. Concurrent inserts can appear before an
existing cursor, and lifecycle changes can remove items between pages. Clients
refresh from the first page when they need the newest view.

## Visibility, failures, and cache policy

Both the SKU and its Product must be `ACTIVE`. A missing SKU, non-public SKU,
or SKU under a non-public Product has the same `not-found` application outcome
and fixed `404` Problem Details response.

The HTTP adapter maps only these outcomes:

| Condition | HTTP status |
| --- | ---: |
| Invalid identifier, limit, or cursor | `400` |
| Missing or non-public detail resource | `404` |
| Classified transient database unavailability | `503` |
| Unexpected persistence, mapping, or unknown failure | `500` |

Failures use the existing fixed RFC 9457 boundary and never echo an identifier,
cursor, SQL, database message, or cause. A list is never `404`. Statuses `422`,
`429`, and `504` are omitted until the API implements those semantics.

Public reads are anonymous and declare no authentication requirement. Success
responses initially use `Cache-Control: no-store`, and automatic ETags remain
disabled. Public caching requires a measured freshness target and an
invalidation owner after write workflows exist. A distributed or edge rate
limit and a genuine database-side execution deadline remain public-deployment
gates; an in-process limiter and `Promise.race` are not production substitutes.

## Composition and enforcement

The API composition root constructs the Prisma repository from the one
runtime-owned database client, inject it into the Catalog use cases, and expose
delivery adapters. Controllers depend on application use cases, never on
Prisma or repository implementations. The database module is neither global
nor registered a second time.

Repository lint rules enforce dependency direction: domain cannot import
application or infrastructure, application cannot import infrastructure or
framework/runtime adapters, and API feature delivery cannot import business
infrastructure. Explicit composition roots are the only exceptions.
Application imports are default-denied outside the module's own application
and domain directories. A future shared kernel or cross-module contract must
therefore earn a narrow, reviewed exception instead of becoming an accidental
back door to another module's implementation.

## Why this design

- Direct query handlers keep policy testable without adding a CQRS bus for two
  operations.
- Keyset pagination has bounded work and remains stable behind the cursor as
  the table grows.
- A small explicit response envelope supports pagination and future metadata
  without a generic `success` or human-message wrapper.
- Active-only `404` behavior prevents lifecycle state from becoming a public
  enumeration channel.
- Primary MySQL reads avoid cache invalidation and replica-lag publication of
  recently hidden records.

## Alternatives and trade-offs

- **Controller calls the repository directly:** less code, but transport would
  own application validation and future cache/authorization policy.
- **NestJS CQRS:** useful with a large command/query pipeline, but currently
  adds decorators and dispatch indirection without a demonstrated need.
- **Offset pagination:** simpler client navigation, but increasingly expensive
  and unstable under concurrent inserts.
- **Signed cursor:** useful when the position carries security or expensive
  filter state, but operationally unnecessary for this public indexed query.
- **Immediate public caching:** reduces database reads but can publish retired
  items until an undefined TTL or invalidation path catches up.
- **Application package allowlist:** convenient for shared libraries, but a
  broad exception can silently reintroduce framework and infrastructure
  coupling; add only capability-specific exceptions when a real use case
  appears.

## Interview questions

1. Why is not-found an application result while database unavailability is an
   error?
2. Why can keyset pagination be stable without being snapshot-consistent?
3. Why does an opaque cursor not automatically require encryption or signing?
4. Why should the API composition root know Prisma while the controller and
   use case do not?
5. Why is `Promise.race` insufficient as a database query timeout?

The vertical integration suite creates an exact isolated local database,
applies the committed migration twice, starts the production API composition,
and verifies the public contract through real HTTP and Prisma calls. It covers
active reads, indistinguishable hidden and missing resources, opaque two-page
traversal, and deterministic UUID ordering for equal timestamps. The suite
removes only its owned fixtures and database.

## Future improvements

- Add a genuine MySQL-side statement deadline before public deployment.
- Add edge or distributed abuse controls when a public host exists.
- Add ETags or short shared-cache TTLs only with a defined staleness budget and
  write-side invalidation owner.
- Add signed, scoped cursors if future filters or authorization state require
  integrity.
- Add search and merchandising ranking as explicit contracts rather than
  silently changing creation-order pagination.
- Implement the accepted
  [Catalog administration](catalog-administration.md) contract before exposing
  authenticated write operations.
