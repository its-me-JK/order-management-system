# ADR 0003: Reserve inventory and create orders atomically

Status: accepted

## Context

Concurrent checkouts must not oversell, retries must not create duplicate orders, and one order must not partially reserve inventory.

## Decision

Create an order in a serializable MySQL transaction. Select one warehouse capable of fulfilling every line, conditionally move each quantity from available to reserved, then create order, line snapshots, pending payment, reservation, movements, history, and outbox intent.

Require a user-scoped `Idempotency-Key` and store a fingerprint of normalized request content. Database uniqueness is the final arbiter.

## Consequences

- Overselling is prevented by conditional affected-row checks plus database balance constraints.
- Retried identical requests return the original order; key misuse returns conflict.
- Serializable contention can abort transactions, so only known conflicts are retried and retries are bounded.
- One-warehouse allocation avoids partial fulfillment but rejects orders that could be split across warehouses.
- Reservations require expiry cleanup before real traffic.

## Alternatives

- Read-then-write at default isolation was rejected because concurrent callers can consume the same availability.
- Redis distributed locks were rejected because lock ownership would not replace the MySQL invariant and creates another failure mode.
- Per-line orders/split shipments were deferred because allocation and fulfillment complexity is outside the current scope.
- A saga across Inventory and Order services is appropriate only after those services own separate databases.
