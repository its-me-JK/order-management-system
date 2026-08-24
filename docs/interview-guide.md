# System-design interview guide

These are the questions this repository should make easy to answer. The useful answer is the trade-off, not the technology name.

## Why start with a modular monolith instead of microservices?

Order placement crosses Catalog validation, inventory reservation, order creation, payment intent, history, and event intent. One MySQL transaction provides a clear consistency boundary while the domain is still evolving. Microservices would require sagas, contract versioning, independent data stores, tracing, and more deployment units. Extract a module when independent scale, fault isolation, compliance, or team ownership is worth that cost.

## How does the system prevent overselling?

It never trusts a prior availability read. Inside a serializable transaction it conditionally updates the inventory row only where `available >= requested`, then checks that exactly one row changed. The database also enforces non-negative balances and `on_hand = reserved + available`. Bounded retry handles known serialization conflicts.

At higher scale, hot SKUs may need partitioning, a dedicated Inventory service, queued reservation commands, or per-SKU serialization. Redis locks would not replace the database invariant.

## Why reserve stock before asynchronous payment?

Without a hold, payment could succeed for inventory that another checkout consumed. The reservation temporarily moves units from available to reserved. Payment failure/cancellation releases them; shipping commits them. The cost is abandoned holds, so a production version needs an expiry worker and a clear policy for payment results arriving after expiry.

## What problem does the transactional outbox solve?

It removes the database/broker dual write. Business state and event intent commit together in MySQL. A worker publishes later. It guarantees recoverability, not instant publication or exactly-once delivery.

## Is the messaging exactly once?

No. RabbitMQ and process crashes make at-least-once the honest guarantee. Consumers insert a `(message_id, consumer)` claim in the same MySQL transaction as their side effect. That gives effect-once behavior for those database writes. External providers still require their own idempotency keys and reconciliation.

## How is order creation idempotent?

The key is unique per user and stored with a fingerprint of normalized order content. A retry with the same key and fingerprint returns the original result; reuse for different content returns 409. The uniqueness constraint resolves concurrent duplicate requests. The key alone is insufficient because accidental key reuse must not return an unrelated order.

## Why Prisma instead of TypeORM?

Prisma gives a schema-first model, explicit generated query API, and predictable eager loading. TypeORM can be productive but depends more heavily on decorators/runtime metadata and makes it easier to hide queries behind entity behavior. Prisma does not solve concurrency: SQL constraints, isolation, conditional updates, and migrations still carry correctness.

## Why is Redis not the inventory source of truth?

Redis is excellent for bounded ephemeral state and caching, but inventory authorization must survive eviction, restart, and cache races. MySQL owns stock. Redis currently holds only login-throttling counters whose loss does not corrupt business data.

## Why fail login closed when Redis is down?

Silently bypassing abuse control turns a dependency outage into an authentication attack window. Returning 503 preserves the policy. The trade-off is reduced login availability. A larger system could use layered edge limits, a bounded local emergency limiter, or risk-based degradation, but that policy must be explicit and observable.

## Why opaque tokens instead of JWTs?

Opaque access tokens allow immediate session/user disablement and avoid stale embedded roles. They cost a MySQL lookup per authenticated request. JWTs reduce lookup load but make revocation and authorization freshness harder; short expiry and a revocation strategy would be required.

## How are browser refresh requests protected?

The refresh token is in an HttpOnly, SameSite=Strict, Secure production cookie scoped to auth routes. JavaScript also sends a separately returned CSRF token. The database stores digests, and refresh conditionally rotates all credentials so a concurrent reuse cannot silently win twice.

## How is event ordering handled?

The design does not claim global ordering. Database state transitions are guarded, consumers are idempotent, and events carry IDs that reload current state. Strict aggregate ordering would require a sequence number and gap handling. Depending only on queue order would fail with multiple consumers and redelivery.

## How would Payment be extracted?

First stabilize versioned commands/events and provider idempotency. Give Payment its own database, consume an order-payment request event, and publish authorized/failed events. Orders becomes a saga/process manager rather than sharing Payment tables. Add signed webhooks, reconciliation, tracing, SLOs, and rollback before switching traffic.

Notification should generally be extracted first because it is already downstream and eventually consistent.

## How would the outbox publisher scale?

The current poller is sufficient for one worker. Multiple publishers need row claims/leases—commonly `SELECT ... FOR UPDATE SKIP LOCKED` in short transactions—or CDC. Duplicate publish remains possible, so consumer idempotency is still required. Monitor oldest unpublished age rather than only row count.

## What does readiness mean?

Liveness means the process can serve HTTP. Readiness means it can safely accept application traffic. The API currently checks MySQL and Redis because MySQL backs all business state and Redis preserves fail-closed login throttling. RabbitMQ is decoupled from HTTP by the durable outbox, so a broker outage does not make the API unready. This is an explicit availability policy, not a universal rule.

## Why snapshot SKU data on order lines?

Catalog names and prices change. An order is a commercial fact and must retain what the customer purchased at that time. Keeping only a foreign key would rewrite history on read. The foreign key still supports traceability, while snapshot fields preserve the contract.

## Why store money as decimal strings at the API boundary?

JSON numbers are IEEE-754 floating point and can introduce rounding surprises. MySQL uses fixed `DECIMAL(12,2)`; the API emits exact strings. Calculations normalize to integer cents for the current two-decimal currency model. Multi-currency support would need currency-specific minor-unit rules.

## What changes for real production traffic?

The domain design remains useful, but the zero-cost deployment does not provide production reliability. Add multi-AZ managed data services, tested backups, private networking, secret rotation, WAF/edge limiting, metrics and alerts, tracing, capacity tests, data retention, incident runbooks, SLOs, and an on-call owner. Replace the simulator with provider adapters, signed webhooks, settlement, and reconciliation.
