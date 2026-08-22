# ADR-0016: Make retryable commands durably idempotent

- **Status:** Accepted
- **Date:** 2026-08-22

## Context

A client can lose an HTTP response after the server commits a Catalog
mutation. Retrying a non-idempotent create or lifecycle action without a
durable command identity can duplicate a Product, repeat audit and event
effects, or turn a successful operation into a confusing optimistic conflict.
Redis alone cannot prove an outcome after eviction or outage, and a process
local cache cannot coordinate replicas.

The repository also needs a consistent lost-update policy. Aggregate versions
already exist, but the HTTP precondition syntax, retry interaction, retention,
and atomic relationship among the mutation, audit record, outbox, and replay
result are not yet defined.

The IETF `Idempotency-Key` document remains an expired Internet-Draft rather
than a published standard. The project must therefore publish its own exact
contract instead of claiming generic interoperability.

## Decision

Every authenticated administrative mutation requires one
`Idempotency-Key` header. The value is an exact canonical lowercase UUIDv4 or
UUIDv7. Missing, repeated, oversized, noncanonical, or malformed values are a
fixed `400`. Raw keys are never logged or included in events.

An idempotency identity is scoped by authenticated actor identifier, stable
application command name, and key digest. An HTTP operation ID maps to that
command name but does not become an application-layer dependency. Session
identifiers are deliberately not part of uniqueness so a correctly authorized
retry can survive access-token or refresh rotation. Authentication and current
authorization run before any replay lookup; a revoked actor cannot retrieve an
old result.

The application computes a versioned semantic request fingerprint after
transport validation. It contains only the stable application command name and
version, target identifiers, validated canonical command values, and expected
aggregate version where applicable. It excludes raw JSON, header ordering,
credentials, request and correlation identifiers, network metadata, and
transport-only noise. A cryptographic digest of that representation is
persisted.

For the initial short, database-only commands, idempotency is committed in the
same MySQL transaction as the aggregate change, immutable audit entry, and
the integration event selected by the accepted command contract. A successful
no-op has no audit or outbox record. The transaction stores a replayable
application result snapshot; it does not store an arbitrary HTTP response or
framework object. A crash before commit leaves none of those effects. A crash
after commit leaves all of them and permits replay.

Every application result snapshot carries `resultSchemaId`,
`resultSchemaVersion`, and `resultKind`. The initial identifiers are
`catalog.product-command-result` and `catalog.sku-command-result`, both at
version 1; result kind is `CREATED` or `UPDATED`. The snapshot also contains
the resource identifier, aggregate version, and exact v1 application
projection. The HTTP adapter maps `CREATED` to `201` with a relative
administrative `Location`, maps `UPDATED` to `200`, and derives the strong ETag
from the aggregate version.

Readers for every unexpired result schema version remain deployed for at least
the seven-day retention window plus rolling-deployment overlap. An
incompatible change to a v1 result or its HTTP projection is prohibited while
v1 rows can still replay; it requires a new result schema and, when the public
representation changes incompatibly, a new API contract version.

A unique database constraint serializes concurrent use of the same scoped key.
There is no separately committed `IN_PROGRESS` claim for these local commands,
so process death cannot strand ownership. A concurrent caller that exceeds the
bounded wait receives a typed, retryable `409`; it does not execute the command
independently. Long-running or provider-calling workflows require a later
leased-ownership extension rather than weakening this local atomic model.

After a completed command:

- the same scoped key and fingerprint replays the original command-result kind
  and resource snapshot; the HTTP adapter reconstructs the original success
  status, `Location`, and aggregate ETag;
- replay receives fresh request and correlation identifiers;
- replay creates no second aggregate mutation, audit entry, or outbox event;
- the same scoped key with a different fingerprint returns a typed `409`;
- authentication, authorization, rate-limit, validation, transient `5xx`, and
  deterministic rejected-command outcomes are not stored as successful
  replays.

Completed administrative records are retained for seven days from completion.
The worker removes expired rows in bounded batches with observable duration and
failure metrics. Clients must not assume replay after the documented window.
Redis may accelerate completed lookup but cannot authorize a replay or replace
the MySQL record.

Creates do not require a version precondition. Every rename and lifecycle
command requires one exact strong `If-Match` entity tag with syntax
`"v<version>"`, where version is a canonical positive decimal supported by the
aggregate version column. Weak tags, wildcard tags, lists, repeated headers,
noncanonical numbers, and malformed values are `400`. Missing `If-Match` is
`428 Precondition Required`; a valid tag that does not match authoritative
state is `412 Precondition Failed`.

The idempotency replay lookup precedes authoritative precondition evaluation
after authentication and authorization. This allows a retry carrying the
original key and old ETag to receive the already committed success. A new key
with that stale ETag receives `412`. Successful mutable representations expose
the new strong ETag.

Lifecycle action resources have no independent state. This contract defines
the selected representation and validator of an action target such as
`/products/{productId}/activate` to be the parent aggregate representation and
its strong ETag. Evaluation order is authentication, authorization,
idempotency replay, target existence, then precondition. A target that does not
exist is `404`; an existing target whose version differs from a valid
`If-Match` is `412`.

Ordinary mutations use optimistic conditional persistence equivalent to
`WHERE id = ? AND version = ?`, incrementing the version once. Zero affected
rows after the authoritative load is exactly a precondition-failed application
outcome because Catalog has no hard-delete command. A unique constraint remains
the final SKU-code conflict guard; a preflight lookup cannot replace it.

## Consequences

### Positive

- A lost response can be retried without duplicating business, audit, or event
  effects.
- Idempotency survives process restarts, Redis loss, and replica changes.
- Conditional requests prevent lost updates while replay recognizes an
  already completed mutation.
- One atomic commit gives a simple recovery invariant with no stranded local
  command ownership.
- Application result snapshots keep NestJS and HTTP types outside persistence
  and business layers.

### Negative

- Every administrative mutation adds a durable row, fingerprinting work, and
  cleanup responsibility.
- Exact replays need a bounded result representation and schema-version policy.
- Concurrent duplicate handling depends on known MySQL uniqueness and lock
  outcomes and requires real contention tests.
- Clients must manage two distinct concepts: retry identity and current
  aggregate version.
- A retry after the seven-day window can no longer rely on the original key.

## Alternatives considered

- **Redis-only idempotency:** faster, but eviction or outage can repeat a
  committed business effect.
- **Process-memory replay cache:** cannot coordinate replicas and disappears on
  restart.
- **Use optimistic version only:** prevents a repeated update but turns a lost
  successful response into `412` and does not protect creates.
- **Require idempotency only on creates:** leaves lifecycle and rename retries
  ambiguous after a committed response is lost.
- **Commit an in-progress claim separately:** avoids waiting on one transaction
  but introduces leases, takeover, and crash recovery without a current need.
- **Store the raw HTTP response:** makes replay easy but couples durable
  application behavior to headers, framework serialization, and occurrence
  identifiers.

## Revisit when

Add leased in-progress ownership when a command must outlive one short database
transaction or coordinate an external provider. Revisit retention using
measured client retry windows and storage volume. If the IETF header is
standardized incompatibly, version the public contract rather than silently
changing accepted syntax or replay behavior.

## References

- [The expired IETF Idempotency-Key draft](https://datatracker.ietf.org/doc/draft-ietf-httpapi-idempotency-key-header/history/)
- [RFC 9110: HTTP Semantics](https://www.rfc-editor.org/rfc/rfc9110.html)
- [RFC 6585: Additional HTTP Status Codes](https://www.rfc-editor.org/rfc/rfc6585.html)
