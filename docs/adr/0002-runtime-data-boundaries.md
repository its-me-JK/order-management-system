# ADR 0002: Give each data technology one explicit role

Status: accepted

## Context

MySQL, Redis, and RabbitMQ are all available, but using each everywhere would create overlapping sources of truth and ambiguous recovery.

## Decision

- MySQL is authoritative for users, sessions, Catalog, Inventory, Orders, Payments, Notifications, outbox, and consumer deduplication.
- Redis stores only bounded disposable login-throttling state.
- RabbitMQ transports committed events with at-least-once delivery.
- Prisma is the application database client; committed SQL migrations add database-level constraints.

Inventory availability, authorization state, and order/payment state must never be decided from Redis or RabbitMQ.

## Consequences

- Recovery has a clear direction: rebuild ephemeral/broker state from committed database intent where possible.
- Redis loss may reset throttling counters but cannot corrupt orders.
- RabbitMQ outage delays workflows while outbox rows remain durable.
- MySQL is a larger shared failure domain until services are extracted.
- Authenticated requests currently pay a MySQL session lookup.

## Alternatives

- Redis-backed sessions would reduce MySQL reads but make session durability/eviction policy part of correctness.
- Cached inventory would improve read speed but risk stale authorization; rejected.
- Database-backed job polling without RabbitMQ would reduce infrastructure but provide weaker routing/dead-letter semantics.
- TypeORM was considered; Prisma's explicit schema/query surface was preferred, while correctness remains in transactions and constraints.
