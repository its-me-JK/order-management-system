# Project progress

Last audited: 2026-08-25.

## Current result

**Overall completion: 90%.**

**Source feature implementation: approximately 97%.**

The lower overall score includes verification and public deployment. The project is not “done” merely because screens and endpoints exist.

## Scoring model

The score is weighted and evidence-based:

| Area | Weight | Current completion | Earned |
| --- | ---: | ---: | ---: |
| Architecture and data foundation | 15% | 100% | 15.0 |
| Backend business workflows | 25% | 96% | 24.0 |
| Asynchronous processing | 15% | 93% | 13.95 |
| Frontend experience | 15% | 92% | 13.8 |
| Tests, security, and quality gates | 15% | 90% | 13.5 |
| Operations and public deployment | 15% | 65% | 9.75 |
| **Total** | **100%** |  | **90.0%** |

Percentages move only when the evidence below changes. A configured deployment file is not a deployment; a live URL is not complete until the business smoke test passes.

## Implemented in source

- Pragmatic NestJS modular monolith with versioned routes.
- Prisma/MySQL model and initial migration for users, sessions, Catalog, Inventory, Orders, Payments, Notifications, outbox, and consumer inbox.
- Registration, login, refresh rotation, logout, bearer authentication, role guard, and Redis login throttling.
- Public Catalog and administrative Product/SKU lifecycle endpoints.
- Warehouse/SKU inventory reads and administrative adjustment with movement audit.
- Idempotent order creation with single-warehouse atomic reservation and price/name snapshots.
- Order cancellation, fulfillment transitions, refund state, and timeline.
- RabbitMQ event envelope/topology, transactional outbox publisher, duplicate-safe payment and notification consumers.
- Deterministic payment simulator with authorized and failed paths.
- Static Next.js frontend for the main customer and admin flows.
- Structured API/worker logs, validated configuration, health endpoints, Problem Details, and OpenAPI foundation.
- Complete local Compose topology with migration, API/static web, worker, MySQL, Redis, and RabbitMQ containers.
- Container build, process supervisor, Render Blueprint, and zero-cost deployment runbook.

## Verification evidence

- Aggregate formatting, Prisma validation/generation, lint, TypeScript, unit-test, and production-build gate passes.
- 293 API/worker/package tests and 2 frontend tests pass.
- Production dependency audit reports no known high-severity vulnerabilities.
- Database integration connects through the production Prisma runtime and queries the committed schema.
- API integration proves real database readiness and a bounded, sanitized MySQL failure.
- A clean production image builds and the Compose migration, MySQL, Redis, RabbitMQ, API, and worker topology becomes healthy.
- The live local smoke test verifies customer/admin authentication, public catalog, idempotent replay and conflict, asynchronous payment, duplicate-safe notifications, shipping, delivery, timeline, and logout.
- A production-file reachability audit found no remaining imports or runtime files from the removed Identity/Catalog design.

## Required before raising the score

### Runtime and failure verification

- Prove duplicate delivery does not duplicate payment/notification side effects.
- Prove API commit survives broker downtime and publishes after recovery.
- Prove concurrent orders cannot oversell one inventory row.
- Verify graceful shutdown with in-flight HTTP, outbox publish, and consumer deliveries.
- Add outbox/dead-letter operational visibility.
- Add automated cancellation, refund, payment-decline, and reservation-expiry end-to-end paths; their implementations currently have unit/contract coverage but are not all in the showcase smoke.

### Public deployment

- Provision zero-cost MySQL, Redis-compatible store, RabbitMQ, API/static web, and worker.
- Configure migration and DML credentials separately.
- Apply the migration and seed showcase data.
- Verify TLS, secrets, health checks, logs, and the full hosted smoke workflow.
- Publish the live URL and deployment limitations in the README.

## Definition of 100%

The project reaches 100% for the current scope only when:

- all committed quality and integration gates are green from a clean clone;
- no production file is unreachable or present only for a removed design;
- the documented API and generated OpenAPI match runtime behavior;
- MySQL, Redis, and RabbitMQ failure/recovery paths have automated evidence;
- security-sensitive flows have negative tests;
- a public zero-cost deployment is live;
- the hosted end-to-end smoke test passes;
- deployment and recovery instructions can be followed without tribal knowledge.

Future capabilities such as real payment processing, multi-warehouse splitting, email, returns, Kubernetes, and service extraction are outside this 100% scope. They are future versions, not reasons to keep the current release permanently incomplete.
