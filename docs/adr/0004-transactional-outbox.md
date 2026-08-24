# ADR 0004: Publish events through a transactional outbox

Status: accepted

## Context

Order/payment state and RabbitMQ cannot participate in one reliable ordinary transaction. Direct publication creates lost or phantom events.

## Decision

Write one `outbox_events` row in the same MySQL transaction as each event-producing mutation. A worker polls due rows, publishes canonical envelopes with RabbitMQ confirms, and marks them published. Consumers manually acknowledge and claim `(message_id, consumer)` in the same transaction as their side effect.

The delivery contract is at least once.

## Consequences

- Broker downtime does not lose committed event intent.
- Publication is asynchronous and introduces measurable lag.
- Duplicate publication/redelivery is expected and safe for current database consumers.
- Polling creates database load and one-worker throughput limits.
- Exhausted retries and dead-letter queues require operator visibility.

## Alternatives

- Publish inside the request transaction was rejected because database and broker outcomes can diverge.
- XA/distributed transactions were rejected as operationally brittle and poorly aligned with the stack.
- Kafka/CDC was deferred until event volume or replay requirements justify additional infrastructure.
- Redis-based deduplication was rejected because it cannot commit atomically with MySQL side effects.
