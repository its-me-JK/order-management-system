# Project progress

- **Overall completion:** 26%
- **Current milestone:** Identity, catalog, pricing, and inventory
- **Public demo:** Not deployable yet
- **Last reviewed:** 2026-08-23

This score covers the complete portfolio scope, including backend behavior,
frontend experience, operational hardening, and public deployment. It measures
accepted outcomes, not lines of code, generated files, commits, or activity.

## Fixed baseline

| Workstream | Weight | Earned | Current evidence |
| --- | ---: | ---: | --- |
| Architecture and contracts | 6% | 5.15% | Architecture overview, sixteen ADRs, platform contracts, delivered Catalog public reads, and accepted Catalog administration contracts covering reversible lifecycle, authorization, durable idempotency, concurrency, audit, and transaction semantics; most business contracts remain |
| Platform and persistence | 9% | 8.25% | Workspace, runtime shells, versioned routing, health, validated configuration, structured logging, strict transport boundaries, deterministic OpenAPI, one runtime-owned Prisma client, MySQL, an ordered module-owned migration, and integration infrastructure |
| Backend business capabilities | 35% | 3.75% | Catalog Product/SKU persistence, UUIDv7 binary mapping, active-only reads, exact seek pagination, bounded public-read use cases, exact anonymous endpoints, and separate immutable Product and SKU aggregates with explicit reversible lifecycles, validated rehydration, versions, timestamps, immutable SKU ownership/code, and internal events exist; no Catalog write use case exists |
| Redis, RabbitMQ, and workers | 9% | 0% | Architecture only |
| Testing, security, and resilience | 11% | 4.25% | Strict quality gates, secret-safe configuration and TLS tests, adversarial HTTP, cursor, Product/SKU lifecycle and Unicode tests, executable Clean Architecture boundaries, isolated real-MySQL migration and constraint tests, and a real NestJS-to-Prisma-to-MySQL Catalog contract suite |
| Frontend showcase | 12% | 0% | Not started |
| Observability and operations | 5% | 1% | Sanitized liveness, bounded MySQL readiness, server-owned request identity, structured HTTP/Nest logs, redaction, and safe fatal bootstrap reporting exist; metrics and traces remain |
| CI/CD and public deployment | 8% | 1.75% | CI replays migrations idempotently and validates database, Catalog, and API contracts against real MySQL; no release pipeline or live environment |
| Documentation and demo polish | 5% | 2.75% | README, architecture contracts, ADR history, deterministic OpenAPI JSON, and a public read-only local Swagger UI exist; examples and demo guides remain |
| **Total** | **100%** | **26.90%** | Displayed overall is rounded down |

The weights are fixed unless the project scope is formally re-baselined. A
workstream may use fractional earned points internally, but the displayed
overall percentage is rounded down so progress is never overstated.

## Completion rules

- Award points only for acceptance criteria committed to `master`.
- Architecture documents earn architecture points, not implementation points.
- A feature is complete only with its required tests, error and security
  behavior, operational signals, and documentation.
- Reopen previously earned points if a required quality gate regresses.
- Track public-demo readiness independently; a high overall score cannot make
  an undeployed or unusable demo complete.
- Recalculate and update this file after every production-ready increment.

## Current status line

> Overall: 26% · Backend business capabilities: 3.75/35 · Frontend: 0/12 ·
> Deployment: 1.75/8 · Public demo: not deployable

The current increment earns no deployment points. Catalog reads are not an
externally usable showcase: the endpoint is production-composed locally, but
there is still no release pipeline, provider resource, live URL, synthetic
showcase data, distributed abuse control, or database-side query deadline.
The accepted administration design earns architecture evidence only; no
administrative route or security capability is counted as complete. The
Product and SKU aggregates earn domain-behavior credit but remain unwired until
the forward lifecycle migration and later application/Unit-of-Work slices
exist. Product eligibility and deterministic Product-first locking for SKU
create, activate, and resume are intentionally not claimed by this increment.
