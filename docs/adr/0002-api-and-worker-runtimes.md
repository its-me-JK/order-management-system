# ADR-0002: Separate API and worker runtimes

- **Status:** Accepted
- **Date:** 2026-08-02

## Context

HTTP requests are latency-sensitive and bounded. Outbox publishing, message
consumption, reservation expiry, reconciliation, retries, and notification
delivery have different scaling, shutdown, and failure characteristics.

Running all work in one process makes background load compete with requests
and makes deployments more likely to interrupt in-flight jobs. Creating
independent services for this work would duplicate business code and
infrastructure prematurely.

## Decision

Build two deployable NestJS processes from the same modular codebase:

- The API runtime owns REST endpoints, authentication, authorization, and
  verified provider webhooks.
- The worker runtime owns scheduled work, outbox publication, RabbitMQ
  consumers, retries, reconciliation, and asynchronous provider adapters.

Both runtimes use the same module application interfaces. Each runtime has a
separate composition root and imports only the adapters it requires.

Workers use graceful shutdown, bounded concurrency, message prefetch, and
health signals appropriate to their responsibilities.

The API can remain ready while RabbitMQ is unavailable because it commits
events to the MySQL outbox. Broker-dependent worker roles report not-ready
until they can safely publish or consume. Redis loss alone does not make either
runtime unready when the active feature can fall back without violating a
security or business invariant.

## Consequences

### Positive

- API and background work can scale and deploy independently.
- Queue backlogs do not directly consume API request capacity.
- The design creates an operational seam useful for later service extraction.
- Business logic is not duplicated or accessed over an internal network.

### Negative

- Two process images or entry points require separate deployment and health
  configuration.
- Scheduled jobs need ownership controls so multiple worker replicas do not
  produce unintended duplicate effects.
- Local development runs an additional process.

## Alternatives considered

- **One combined process:** simpler initially, but couples unrelated workload
  and shutdown behavior.
- **Independent background microservices:** creates deployment and contract
  overhead without a distinct business boundary.
- **In-process fire-and-forget tasks:** loses work on crashes and provides no
  backpressure or durable retry behavior.

## Revisit when

Split worker responsibilities further when measurements show materially
different scaling, isolation, compliance, or ownership requirements.
