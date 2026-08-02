# ADR-0003: Keep inventory correctness in MySQL

- **Status:** Accepted
- **Date:** 2026-08-02

## Context

Concurrent order attempts can target the same SKU and warehouse. Accepting
more reservations than usable stock damages customer trust and creates manual
operational work. Redis offers low latency and atomic operations but is also a
cache with different durability, failover, and recovery behavior from the
authoritative transactional database.

Correctness must survive process crashes, retries, cache loss, and concurrent
requests.

## Decision

MySQL is the source of truth for stock, reservations, and inventory movements.

The stock row is the operational balance used for availability and conditional
reservation. The movement table is its immutable audit and reconciliation
ledger; it is not recalculated for every request. Scheduled and operator-driven
reconciliation detects divergence between the two representations.

Order placement uses a short database transaction and a conditional stock
mutation that succeeds only when usable stock can satisfy the requested
quantity. It creates the reservation and immutable movement record in the same
transaction. Mutable stock rows carry an optimistic version, while unique
business references make repeated mutations idempotent.

Redis may cache short-lived availability projections, but those projections
are advisory and are revalidated in MySQL before an order is accepted. A Redis
lock is not part of the correctness boundary.

## Consequences

### Positive

- Inventory and its audit trail commit atomically.
- Correctness is independent of cache availability or lock expiry.
- Concurrency behavior can be tested using the same MySQL semantics used in
  production.
- Reservation expiry and release remain durable and reconcilable.

### Negative

- Hot stock rows can become contention points during extreme demand.
- Availability shown before checkout may be stale by the time a reservation is
  attempted.
- Careful indexing, short transactions, retry policy, and contention metrics
  are required.

## Alternatives considered

- **Redis atomic counters as the source of truth:** low latency but adds
  durability and reconciliation risk to the most important invariant.
- **Distributed locks around read-then-write logic:** lock leases and failover
  add failure modes without replacing the database constraint.
- **Serializable transactions for all order work:** strong semantics but wider
  contention and deadlock cost than a narrow conditional mutation.
- **Asynchronous reservation after order acceptance:** improves apparent
  availability but permits orders the system cannot fulfill.

## Revisit when

If measured contention exceeds MySQL capacity, consider partitioning by SKU and
warehouse, admission control for flash sales, or a dedicated inventory service
with a serialized command model. Preserve durable reservations and an
auditable source of truth.
