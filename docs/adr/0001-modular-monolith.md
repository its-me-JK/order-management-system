# ADR 0001: Use a modular monolith with separate runtimes

Status: accepted

## Context

The order workflow needs strong consistency across inventory, order, payment intent, and event intent. Domain boundaries are still changing, the project has one owner, and the showcase must run at minimal cost.

## Decision

Keep Auth, Catalog, Inventory, Orders, Payments, and Notifications in one NestJS modular monolith and one MySQL schema. Run HTTP and asynchronous work as separate processes. Keep the Next.js application in the same repository but export it as static assets.

Feature modules own their controllers, use cases, and persistence logic. Shared packages are reserved for cross-runtime technical capabilities, not created for every entity.

## Consequences

- Cross-module business changes can commit atomically and refactor locally.
- One migration history and one deployment version simplify operation.
- Module isolation relies on code review/linting rather than network boundaries.
- API and worker can scale/restart separately.
- A hosting platform may co-locate processes for a showcase, but that is a deployment compromise.

## Alternatives

- Immediate microservices were rejected because they add sagas, network failure, versioned contracts, tracing, and separate stores without an independent scale/team requirement.
- A single API-plus-consumer process was rejected as the logical design because it couples failure and shutdown domains.
- A multi-repository design was rejected because atomic changes across contracts and clients would be slower at this stage.

## Revisit when

Notification or Payment has separate ownership, compliance, release cadence, or scaling needs that outweigh distributed-systems cost.
