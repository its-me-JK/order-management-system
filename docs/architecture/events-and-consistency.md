# Events and consistency

## Why RabbitMQ is present

RabbitMQ removes payment simulation and notification creation from the HTTP latency path and demonstrates asynchronous workflow behavior. It is not used for commands that require an immediate, strongly consistent answer, and it is not treated as durable business state.

The current topology contains:

- durable topic exchange `oms.events`;
- durable dead-letter exchange `oms.events.dlx`;
- `oms.payment`, bound to `order.created`;
- `oms.notification`, bound to `order.*` and `payment.*`;
- one dead-letter queue for each consumer;
- manual acknowledgements, bounded prefetch, persistent messages, and publisher confirms.

## Event envelope

Every message has exactly four JSON fields:

```ts
type EventEnvelope = {
  id: string;         // UUID; also AMQP messageId
  type: string;       // lower-case dotted routing key
  occurredAt: string; // canonical ISO UTC instant
  payload: JsonValue; // bounded to 256 KiB with the envelope
};
```

The RabbitMQ routing key and AMQP `type` must equal the envelope type. The AMQP `messageId` must equal the envelope ID. Invalid content type, envelope, or metadata is dead-lettered.

Current business events:

| Event | Producer | Consumers | Payload |
| --- | --- | --- | --- |
| `order.created` | Order transaction | Payment, Notification | `orderId`, `userId`, `paymentId` |
| `order.cancelled` | Order cancellation | Notification | `orderId`, `userId` |
| `order.shipped` | Fulfillment command | Notification | `orderId`, `userId` |
| `order.delivered` | Fulfillment command | Notification | `orderId`, `userId` |
| `payment.authorized` | Payment consumer | Notification | `orderId`, `userId`, `paymentId` |
| `payment.failed` | Payment consumer | Notification | `orderId`, `userId`, `paymentId` |
| `payment.refunded` | Order/payment command | Notification | `orderId`, `userId`, `paymentId` |

Consumers use identifiers from the payload to reload authoritative state. They do not trust event-carried price, total, customer, or inventory data.

## Transactional outbox

Publishing directly inside an order transaction has two bad outcomes:

1. database commit succeeds and broker publish fails, so downstream work never happens;
2. broker publish succeeds and database commit fails, so consumers observe a nonexistent order.

The API instead inserts `outbox_events` in the same MySQL transaction as the business mutation. The worker:

1. selects due unpublished records in creation order;
2. constructs and validates the canonical envelope;
3. publishes with `mandatory` routing and waits for the broker confirm;
4. conditionally marks the row published;
5. on failure increments attempts and schedules capped exponential backoff.

The database and broker are therefore **eventually consistent**. A committed order remains recoverable while RabbitMQ is unavailable because its outbox row is durable.

## Delivery guarantee

The system provides at-least-once publication and consumption, not exactly-once delivery.

A worker can publish successfully and crash before marking the outbox row, causing a duplicate publish. RabbitMQ can redeliver when an acknowledgement is lost. Each consumer starts its database transaction by inserting:

```text
(message_id, consumer_name)
```

into `processed_messages`. A duplicate primary key means the event was already applied by that consumer, so it returns successfully without repeating the side effect. The claim and side effect commit together.

This is effect-once behavior for the current MySQL side effects. It does not magically make an external email or payment API exactly once; those adapters need provider idempotency keys and reconciliation.

## Retry and dead-letter behavior

- Invalid event types/payloads and impossible referenced state are dead-lettered.
- Unexpected transient consumer failures are negatively acknowledged with requeue.
- Outbox publication failures use database-backed exponential backoff and a maximum attempt count.
- Acknowledgement ambiguity is allowed to redeliver because consumers are idempotent.

The current immediate consumer requeue can become a hot loop during a persistent dependency failure. Before real traffic, add delayed retry queues or broker-native delayed delivery, retry counters, poison-message alarms, and an operator replay procedure.

Rows that exhaust outbox attempts remain visible for operations; they are never deleted silently. Monitoring must alert on oldest unpublished age and exhausted attempts.

## Ordering

RabbitMQ preserves queue order only within the constraints of one queue/channel; redelivery and multiple consumers can change completion order. The application must not depend on global event order.

Current state transitions are guarded in MySQL. A notification uses the event type for copy but reloads the referenced order. If later consumers require strict per-order ordering, add aggregate sequence numbers and reject/defer gaps rather than relying on broker timing.

## Redis usage

Redis is intentionally not a cache or source of truth today. It implements one concrete policy: login attempt throttling.

- Key: `oms:auth:login:<sha256(normalized-email)>`
- Window: five minutes
- Limit: ten attempts
- Success deletes the counter
- The Redis ACL permits only the `oms:*` namespace and required commands
- Local Redis has bounded memory and no persistence because losing throttling counters is acceptable
- Login fails closed when Redis is unavailable; existing sessions continue through MySQL

Why not cache Catalog immediately? Cache invalidation and stale availability would add correctness risks without measured need. Public Catalog caching can be added later with short TTLs and event-driven invalidation. Inventory availability must never be authorized from a cache.

## Trade-offs

- **Outbox polling versus change-data capture:** polling is portable and easy to understand, but adds query load and latency. CDC scales better at high volume but adds infrastructure and operational expertise.
- **RabbitMQ versus Kafka:** RabbitMQ fits task-oriented routing, acknowledgements, retry, and modest event volume. Kafka is stronger for long-retained replayable streams, but would be expensive ceremony for this stage.
- **Database inbox versus Redis deduplication:** a MySQL claim commits atomically with the side effect. Redis would be faster but could expire or commit independently.
- **Payload IDs versus full snapshots:** IDs reduce stale/PII-heavy events and keep MySQL authoritative, but consumers perform a database read and would need redesign after service extraction.

## Future improvements

- Claim/lease outbox rows with `SKIP LOCKED` for safe horizontal publisher scaling.
- Add outbox lag, publish failure, queue depth, redelivery, and dead-letter metrics.
- Introduce delayed retry queues and a signed/manual dead-letter replay tool.
- Add event schema version and producer metadata before any service extraction.
- Propagate trace and correlation context in broker headers.
- Purge/partition published outbox and old processed-message rows under a retention policy.
- Use provider idempotency keys and reconciliation for real payment/email side effects.
