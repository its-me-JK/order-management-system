# Architecture overview

## System shape

The repository is a monorepo, not a single process. It contains three deployable runtimes:

1. **API** — a NestJS modular monolith that owns synchronous business commands and queries.
2. **Worker** — a Node.js process that publishes the transactional outbox and consumes RabbitMQ events.
3. **Web** — a Next.js application exported as static files; in production those files are served under the API origin.

All business modules currently share one MySQL database because order placement needs strong consistency across order, payment intent, inventory reservation, history, and the outbox record. Redis and RabbitMQ have deliberately narrower responsibilities.

## Why a modular monolith

The product has distributed-systems behavior without pretending every noun deserves a service. Splitting Catalog, Inventory, Orders, Payment, and Notification today would add network failure, contract versioning, distributed tracing, deployment, and data-consistency problems before there is independent scale or team ownership to justify them.

A modular monolith keeps:

- one atomic transaction for the critical order-placement invariant;
- local refactoring while boundaries are still being learned;
- one migration history and one operational database;
- fewer zero-cost deployment units;
- explicit feature ownership through Nest modules and feature-local files.

The worker is separate because polling and broker consumption have a different lifecycle from HTTP traffic. A stuck consumer must not consume API request capacity, and HTTP restarts should not interrupt message acknowledgement more than necessary.

### Alternatives considered

- **Microservices immediately:** stronger runtime isolation and independent scaling, but materially more failure modes and cost. Rejected until Payment or Notification has an evidence-based extraction reason.
- **One process for API and consumers:** cheapest deployment, but couples health, shutdown, CPU, and failure domains. Acceptable only as a showcase hosting compromise, not the logical architecture.
- **Synchronous payment during checkout:** simpler response semantics, but increases latency and couples order availability to a payment provider. The asynchronous state transition is more representative of real commerce systems.
- **Server-rendered Next.js:** useful for SEO and server data fetching, but requires another always-on runtime. Static export is sufficient for an authenticated portfolio application.

## Runtime responsibilities

### API modules

| Module | Owns | Does not own |
| --- | --- | --- |
| Auth | registration, login, opaque sessions, refresh rotation, logout, current principal, role guard | social login, password reset, MFA, fine-grained permissions |
| Catalog | Product and SKU lifecycle, public active listings, price and descriptive data | stock balances, promotions, tax |
| Inventory | warehouse/SKU balances, adjustments, movement audit, reservation balance invariants | catalog descriptions, carrier fulfillment |
| Orders | idempotent placement, snapshots, reservation orchestration, lifecycle, customer/admin reads | payment-provider I/O, notification delivery |
| Payments | payment view, refund transition, simulated authorization result consumed by worker | real provider credentials, capture, settlement, reconciliation |
| Notifications | per-user in-app notification list and read state | email/SMS provider delivery |
| Platform | configuration, Prisma lifecycle, Redis lifecycle, health, validation, RFC 9457 errors, OpenAPI, structured logging | business policy |

Payment is currently part of the Orders Nest module because its transaction and lifecycle are tightly coupled to Order. It is still a distinct data model and event boundary, making later extraction possible without creating a premature internal package.

### Worker modules

| Component | Responsibility |
| --- | --- |
| Outbox publisher | poll due unpublished rows, publish a canonical envelope with confirms, mark success or schedule bounded exponential retry |
| Payment consumer | consume `order.created`, claim the message idempotently, simulate authorize/fail, update order/payment/reservation, write the next outbox event |
| Notification consumer | consume `order.*` and `payment.*`, claim the message idempotently, create one in-app notification |
| Messaging runtime | declare durable topic exchanges, queues, bindings, dead-letter queues, manual acknowledgement, prefetch, and publisher confirms |

### Web modules

| Area | Responsibility |
| --- | --- |
| Auth provider | keep the access token in memory, refresh with the HttpOnly cookie and CSRF value, attach bearer credentials |
| Catalog | display active SKUs and availability |
| Cart/checkout | local cart state, shipping form, idempotent order submission |
| Orders | list, inspect, and cancel orders |
| Notifications | list and mark in-app messages read |
| Admin | inspect inventory, adjust stock, and advance fulfillment |
| API client | same-origin requests by default, correlation IDs, runtime response validation with Zod, Problem Details mapping |

## Request and event flow

### Order placement

1. The customer sends `POST /api/v1/orders` with a bearer access token and `Idempotency-Key`.
2. The API hashes the normalized request to create an idempotency fingerprint.
3. A serializable MySQL transaction checks the existing idempotency record, validates active SKUs, selects one warehouse that can fulfill the entire order, and conditionally decrements `available`.
4. The same transaction creates the order, immutable item snapshots, pending payment, reservation, inventory movements, status history, and `order.created` outbox row.
5. The worker publishes the outbox row to RabbitMQ using a confirm channel.
6. The payment consumer idempotently authorizes or fails the simulated payment. Failure releases stock; success confirms the order.
7. The payment result is written to the outbox. The notification consumer turns relevant order/payment events into in-app notifications.

No HTTP request performs a database-plus-broker dual write.

### Authentication

1. Registration or login returns a 15-minute opaque bearer access token and CSRF token.
2. The 30-day opaque refresh token is sent only in the `oms_refresh` HttpOnly, SameSite=Strict cookie scoped to `/api/v1/auth`.
3. Only SHA-256 token digests are stored in MySQL. Passwords use Node's scrypt with a random salt.
4. Refresh rotates access, refresh, and CSRF credentials using a conditional database update.
5. Login attempts increment a five-minute Redis key derived from a digest of the normalized email. More than ten attempts are rejected.

Redis failure currently fails login closed with 503. Existing access-token authentication continues to use MySQL and does not depend on Redis.

## Applying Clean Architecture without ceremony

The dependency direction is controller → feature service → persistence boundary. Complex transactional features (Orders, Inventory, Notifications) use repository contracts so business orchestration can be tested independently of Prisma. Auth and Catalog currently use Prisma directly inside their feature services because adding pass-through ports would create files without a second implementation or meaningful policy seam.

This is intentional. Clean Architecture is used to protect volatile business policy and external boundaries, not to maximize interface count. A repository interface should be introduced when at least one of these is true:

- persistence logic obscures the use case;
- more than one implementation is required;
- transaction behavior needs isolated tests;
- extraction requires an explicit application port.

Cross-feature imports should target a feature's public Nest module or small contract, never another feature's Prisma adapter.

## Operational behavior

- Configuration is parsed once at process startup and fails fast on invalid or ambiguous secrets.
- Deployed MySQL and Redis connections require identity-verifying TLS.
- API requests receive request/correlation identities and structured JSON logs with redaction.
- DTO validation rejects unknown fields and malformed transport values.
- HTTP failures use `application/problem+json` rather than leaking exception details.
- `/health/live` reports process liveness; `/health/ready` verifies MySQL and Redis, the dependencies required for the complete API contract.
- Worker logs operational events as one-line JSON and shuts down consumers, publisher, then database.

## Extraction path

Notification is the easiest first extraction because it already reacts to events and owns no synchronous order invariant. Payment is harder: a real provider introduces webhooks, idempotency, reconciliation, and a separately owned data store. When extracted:

1. define versioned event schemas and compatibility tests;
2. give the service its own database and migrations;
3. replace shared-table reads with event-carried data or explicit APIs;
4. introduce trace propagation and service-level SLOs;
5. deploy, observe, and rehearse rollback before removing the in-process module.

Do not extract Inventory merely to draw a microservice diagram. Reservation requires a carefully designed ownership protocol—typically an Inventory service command with idempotency and a saga—not cross-database transactions.

## Future improvements

- Expire abandoned reservations with a scheduled, idempotent release job.
- Replace simulated payment with an adapter, signed webhook ingress, capture/refund idempotency, and reconciliation.
- Add warehouse allocation strategy, split shipments, backorders, and safety stock.
- Add permission-based authorization and an auditable operator identity to administrative changes.
- Cache catalog reads in Redis only after measuring a read bottleneck; invalidate from committed events.
- Add OpenTelemetry traces, metrics, broker lag/outbox-age alerts, and dashboards.
- Partition or archive inventory movements, order history, sessions, outbox, and processed-message records.
- Extract Notification, then Payment, only when separate ownership or scaling pays for the operational complexity.
