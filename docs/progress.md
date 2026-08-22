# Project progress

- **Overall completion:** 23%
- **Current milestone:** Identity, catalog, pricing, and inventory
- **Public demo:** Not deployable yet
- **Last reviewed:** 2026-08-22

This score covers the complete portfolio scope, including backend behavior,
frontend experience, operational hardening, and public deployment. It measures
accepted outcomes, not lines of code, generated files, commits, or activity.

## Fixed baseline

| Workstream | Weight | Earned | Current evidence |
| --- | ---: | ---: | --- |
| Architecture and contracts | 6% | 4.75% | Architecture overview, thirteen ADRs, platform contracts, and the first explicit Catalog ownership, lifecycle, visibility, identifier, and pagination decisions; most business contracts remain |
| Platform and persistence | 9% | 8.25% | Workspace, runtime shells, versioned routing, health, validated configuration, structured logging, strict transport boundaries, deterministic OpenAPI, one runtime-owned Prisma client, MySQL, an ordered module-owned migration, and integration infrastructure |
| Backend business capabilities | 35% | 1.25% | Catalog public-read port, Product/SKU persistence records, UUIDv7 binary mapper, active-only Prisma adapter, and exact seek pagination exist; no Catalog use case, write path, or endpoint exists |
| Redis, RabbitMQ, and workers | 9% | 0% | Architecture only |
| Testing, security, and resilience | 11% | 3.5% | Strict quality gates, secret-safe configuration and TLS tests, adversarial HTTP tests, single-client and import-boundary tests, defensive Catalog mapping/error tests, isolated real-MySQL migration and constraint tests, microsecond pagination, and live adapter-outage classification |
| Frontend showcase | 12% | 0% | Not started |
| Observability and operations | 5% | 1% | Sanitized liveness, bounded MySQL readiness, server-owned request identity, structured HTTP/Nest logs, redaction, and safe fatal bootstrap reporting exist; metrics and traces remain |
| CI/CD and public deployment | 8% | 1.75% | CI replays migrations idempotently and validates database, Catalog, and API contracts against real MySQL; no release pipeline or live environment |
| Documentation and demo polish | 5% | 2.75% | README, architecture contracts, ADR history, deterministic OpenAPI JSON, and a public read-only local Swagger UI exist; examples and demo guides remain |
| **Total** | **100%** | **23.25%** | Displayed overall is rounded down |

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

> Overall: 23% · Backend business capabilities: 1.25/35 · Frontend: 0/12 ·
> Deployment: 1.75/8 · Public demo: not deployable

The current increment earns no deployment points. Catalog persistence is not
an externally usable vertical slice: there is still no feature endpoint,
release pipeline, provider resource, live URL, or synthetic showcase data.
