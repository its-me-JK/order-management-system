# Database design

MySQL is the transactional source of truth. Prisma defines the application schema and generates the client; the committed SQL migration adds database constraints that cannot be expressed completely in the Prisma schema.

## Entity groups

### Identity and sessions

| Table | Purpose | Important constraints |
| --- | --- | --- |
| `users` | customer/operator identity, password digest, role and status | unique normalized email |
| `sessions` | access/refresh/CSRF digests and expiry/revocation state | unique access and refresh digests; cascade on user deletion |

Raw passwords and raw tokens are never persisted. Disabling a user invalidates authentication at read time.

### Catalog

| Table | Purpose | Important constraints |
| --- | --- | --- |
| `products` | merchandising parent, description and lifecycle | optimistic `version`; public status/time index |
| `skus` | sellable unit, stable code, price, currency and lifecycle | unique code; restrictive Product foreign key; optimistic `version` |

Product and SKU are separate because inventory, order lines, and price attach to a sellable variant, while merchandising copy and grouping attach to the Product. Public queries return only ACTIVE SKUs whose Product is also ACTIVE.

### Inventory

| Table | Purpose | Important constraints |
| --- | --- | --- |
| `warehouses` | fulfillment location | unique warehouse code |
| `inventory_items` | current balance per warehouse/SKU | unique pair; non-negative balances; `on_hand = reserved + available` |
| `inventory_reservations` | order-level stock hold and expiry | one reservation per order; explicit ACTIVE/COMMITTED/RELEASED/EXPIRED status |
| `inventory_reservation_lines` | held quantity by SKU | positive quantity; composite primary key |
| `inventory_movements` | append-style audit of receipts, adjustments, reservations, releases and commits | indexed by SKU/time |

The balance row is optimized for concurrency-safe availability checks. The movement table is the audit trail, not the balance used for every read. Any write that changes a balance and its movement occurs in the same transaction.

### Orders and payments

| Table | Purpose | Important constraints |
| --- | --- | --- |
| `orders` | customer order, lifecycle, totals, shipping snapshot and idempotency | unique order number; unique `(user_id, idempotency_key)`; fingerprint detects key reuse |
| `order_items` | immutable SKU/name/price snapshots | positive quantity; exact line-total check |
| `order_status_history` | lifecycle audit | ordered by order/time |
| `payments` | one payment state per order | unique order and provider reference; non-negative amount |

Order lines snapshot code, name, unit price, and total. Historical orders therefore do not change when Catalog changes. Shipping address is a JSON snapshot because the current use case reads and writes it atomically; searchable address normalization can be added when fulfillment queries require it.

Money uses `DECIMAL(12,2)` in MySQL and strings at the API boundary. Business calculations normalize to cents, avoiding IEEE-754 rounding in persisted amounts.

### Events and notifications

| Table | Purpose | Important constraints |
| --- | --- | --- |
| `outbox_events` | durable intent to publish a committed business event | due/unpublished index, bounded attempt state |
| `processed_messages` | consumer inbox/deduplication claim | composite primary key `(message_id, consumer)` |
| `notifications` | user-visible in-app message and read state | unique event/user/channel; unread/time index |

The outbox and business mutation share a transaction. A consumer claims a message and applies its side effect in its own transaction, so redelivery is harmless.

## Critical invariants

### Inventory balance

```text
on_hand >= 0
reserved >= 0
available >= 0
on_hand = reserved + available
```

Order placement uses a conditional update equivalent to:

```sql
UPDATE inventory_items
SET available = available - :quantity,
    reserved = reserved + :quantity,
    version = version + 1
WHERE id = :id
  AND available >= :quantity;
```

Affected-row count must be one. This prevents overselling even when two transactions observed the same earlier balance. Serializable transactions are retried only for Prisma's known write-conflict/deadlock classification and the retry count is bounded.

### Idempotent order creation

The client supplies an `Idempotency-Key`. The server stores both the key and a SHA-256 fingerprint of normalized actor, items, quantities, and shipping address.

- Same user + same key + same fingerprint returns the original order.
- Same user + same key + different fingerprint returns 409.
- A database uniqueness race is resolved by loading and comparing the committed row.

The key is scoped to the user, so different customers may use the same value.

### State transitions

The API permits only explicit transitions:

```text
PENDING_PAYMENT -> CONFIRMED | PAYMENT_FAILED | CANCELLED
CONFIRMED       -> SHIPPED | CANCELLED
PROCESSING      -> SHIPPED | CANCELLED
SHIPPED         -> DELIVERED
```

Payment failure releases an ACTIVE reservation. Shipping converts the reservation to COMMITTED and decrements `on_hand` and `reserved` together. Cancellation releases an ACTIVE reservation and cancels or refunds the payment depending on prior authorization.

Transition methods are repeat-safe for their completed target where appropriate, but invalid forward/backward transitions return conflict rather than silently mutating state.

## Transaction boundaries

| Operation | Isolation | Atomic work |
| --- | --- | --- |
| Create order | Serializable | idempotency, SKU validation, warehouse selection, inventory reservation, order/items/payment/history/movements/outbox |
| Payment result | Serializable | message claim, order/payment state, reservation release/extension, history, outbox |
| Cancel order | Serializable | reservation release, payment state, order/history, outbox |
| Ship order | Serializable | inventory commit, reservation status, order/history, outbox |
| Deliver/refund | default transaction | one guarded lifecycle mutation plus outbox |
| Notification event | Read committed | message claim and notification insert |
| Manual inventory adjustment | transaction | balance and movement |

Long external calls never occur inside a database transaction. RabbitMQ publication happens after commit through the outbox worker.

## Index strategy

Indexes support concrete access paths:

- current access/refresh token lookup;
- active session expiry maintenance;
- active Product/SKU listings;
- SKU availability by warehouse;
- reservation expiry scans;
- customer and operator order timelines;
- payment status operations;
- unread notifications;
- due outbox polling and aggregate event history.

Indexes should be changed from observed query plans and latency, not added for every column. Each secondary index increases write amplification for order and inventory hot paths.

## Migration policy

- `packages/database/prisma/oms.prisma` is the model source.
- `packages/database/prisma/migrations` is the deployable history.
- CI validates the schema, applies migrations to an empty MySQL instance, and checks that a second deploy is a no-op.
- Deployed application credentials receive DML privileges; migration credentials should be separate and short-lived.
- Expand/contract migrations are required after the first public deployment. Destructive column changes must not be combined with the application rollout that stops using them.

The current single initial migration is acceptable only because the project has not yet established a public production data history. Once deployed, it must never be squashed.

## Alternatives and trade-offs

- **TypeORM:** decorator-based entities can feel natural in NestJS, but runtime metadata, migration drift, and lazy-loading footguns are unnecessary here. Prisma's explicit query surface and generated types are preferred.
- **Event sourcing:** would provide a complete history, but projections, replay, schema evolution, and operational complexity are disproportionate. Current state plus explicit history/movement tables gives the needed auditability.
- **Compute inventory from movements:** maximizes ledger purity but makes availability a costly aggregate and complicates locking. A constrained balance plus movements serves the checkout path better.
- **One inventory row across all warehouses:** simpler, but destroys fulfillment-location ownership and prevents later allocation strategies.
- **Distributed transaction with RabbitMQ:** XA-style coordination is poorly supported operationally and increases coupling. The outbox accepts at-least-once delivery instead.

## Future database work

- Reservation expiry worker and partial index/partition strategy for due holds.
- Data retention for sessions, outbox events, processed messages, and notification history.
- Archival/partitioning for inventory movements and order history.
- Read replicas for catalog/order history only; never route reservation writes through a replica.
- Separate databases when Notification or Payment is extracted.
- Provider webhook, payment attempt, refund, reconciliation, shipment, return, and audit-actor models.
