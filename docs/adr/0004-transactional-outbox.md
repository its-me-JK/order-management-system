# ADR-0004: Use a transactional outbox for integration events

- **Status:** Accepted
- **Date:** 2026-08-02

## Context

Many committed changes must trigger asynchronous work. For example, a
confirmed order may start fulfillment and notification workflows. Publishing
to RabbitMQ before a database commit can expose an event for state that later
rolls back. Publishing after commit can lose the event if the process crashes
between the two operations.

MySQL and RabbitMQ do not share a practical atomic transaction.

## Decision

Write each integration event to an outbox table in the same MySQL transaction
as its aggregate change. A worker claims unpublished records, publishes
persistent messages to RabbitMQ with publisher confirms, and marks publication
progress idempotently.

RabbitMQ delivery is at least once. Every event has a globally unique event ID,
schema version, aggregate version, correlation and causation metadata. Every
consumer handles duplicates using a durable inbox record or an equally strong
business uniqueness constraint.

Consumers use manual acknowledgements, bounded retries with backoff, and a
dead-letter queue. Operators can inspect and replay failed messages through a
controlled procedure.

## Consequences

### Positive

- A committed business change cannot silently miss its integration event.
- Publishing recovers after worker or broker outages.
- Producers and consumers are independently retryable and observable.
- The approach creates a reliable seam for future service extraction.

### Negative

- Consumers may observe events after a delay and must handle duplicates or
  reordering.
- The outbox needs retention, lag monitoring, claim coordination, and recovery
  procedures.
- Event contracts require compatibility discipline.

## Alternatives considered

- **Publish directly after commit:** leaves an unavoidable crash window.
- **Publish before commit:** can advertise state that never commits.
- **Distributed transactions:** unsupported or operationally disproportionate
  for MySQL and RabbitMQ.
- **RabbitMQ as the source of truth:** does not replace queryable domain state,
  transactional constraints, or the audit model.
- **Change-data capture:** viable later, but adds infrastructure and still
  requires deliberate event contract design.

## Revisit when

Consider change-data capture when outbox polling or publication volume becomes
a measured bottleneck. The atomic write, idempotent consumption, and versioned
contract guarantees must remain.
