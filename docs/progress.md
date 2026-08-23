# Project progress

- **Overall completion:** 33%
- **Current milestone:** Identity, catalog, pricing, and inventory
- **Public demo:** Not deployable yet
- **Last reviewed:** 2026-08-23

This score covers the complete portfolio scope, including backend behavior,
frontend experience, operational hardening, and public deployment. It measures
accepted outcomes, not lines of code, generated files, commits, or activity.

## Fixed baseline

| Workstream | Weight | Earned | Current evidence |
| --- | ---: | ---: | --- |
| Architecture and contracts | 6% | 5.95% | Architecture overview, seventeen ADRs, platform contracts, delivered Catalog public reads, accepted Catalog administration contracts, and an exact Identity/session contract now fixing Account, authenticator, Role/Permission, generation-proven AccessCredential and RefreshCredential issuance, the cross-module authenticated-principal boundary, atomic rotation/replay, opaque credential transport, authoritative permission, browser security, and fail-closed abuse boundaries; most business contracts remain |
| Platform and persistence | 9% | 8.75% | Workspace, runtime shells, versioned routing, health, validated configuration, structured logging, strict transport boundaries, deterministic OpenAPI, one runtime-owned Prisma client, MySQL, an ordered forward-only migration history, guarded Catalog lifecycle expansion/backfill/contraction, and integration infrastructure |
| Backend business capabilities | 35% | 6.95% | Catalog public reads and Product/SKU aggregates exist. Identity now has separate immutable Account, PasswordAuthenticator, Role, and SessionFamily boundaries plus versionless RefreshCredential and AccessCredential children. Creation and rotation return complete generation-matched issuance bundles, and the first application contract exposes only a nominal immutable principal type backed by strict bounded authority evidence; Identity still has no resolver use case or route |
| Redis, RabbitMQ, and workers | 9% | 0% | Architecture only |
| Testing, security, and resilience | 11% | 5.85% | Strict quality gates, secret-safe configuration/TLS and adversarial HTTP tests, Catalog lifecycle/Unicode tests, exhaustive Identity Account/authenticator/Role tests, adversarial session-credential chronology/generation/expiry/replay tests, and authenticated-principal authority-bound, ordering, nominal-typing, Proxy, redaction, and immutability tests; executable architecture boundaries, real-MySQL migration suites, and a real NestJS-to-Prisma-to-MySQL Catalog contract suite |
| Frontend showcase | 12% | 0% | Not started |
| Observability and operations | 5% | 1% | Sanitized liveness, bounded MySQL readiness, server-owned request identity, structured HTTP/Nest logs, redaction, and safe fatal bootstrap reporting exist; metrics and traces remain |
| CI/CD and public deployment | 8% | 1.75% | CI replays migrations idempotently and validates database, Catalog, and API contracts against real MySQL; no release pipeline or live environment |
| Documentation and demo polish | 5% | 2.75% | README, architecture contracts, ADR history, deterministic OpenAPI JSON, and a public read-only local Swagger UI exist; examples and demo guides remain |
| **Total** | **100%** | **33.00%** | Displayed overall is rounded down |

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

> Overall: 33% · Backend business capabilities: 6.95/35 · Frontend: 0/12 ·
> Deployment: 1.75/8 · Public demo: not deployable

The current increment earns no deployment points. Catalog reads are not an
externally usable showcase: the endpoint is production-composed locally, but
there is still no release pipeline, provider resource, live URL, synthetic
showcase data, distributed abuse control, or database-side query deadline.
The Catalog persistence contract now represents the aggregate lifecycle and
has a real prior-release upgrade proof, but no administrative route, write use
case, audit/idempotency storage, or coordinating Unit of Work is counted as
complete. Identity currently stops at non-exported Account,
PasswordAuthenticator, Role, PermissionCode, SessionFamily,
RefreshCredential, and AccessCredential domain slices with complete atomic
creation/rotation results plus one type-only `IdentityAuthenticatedPrincipal`
application contract. There is still no resolver use case, application port or
Unit of Work, Identity MySQL schema, token/digest adapter, Argon2 provider,
password-input policy, offline command, session-revocation transaction,
trusted ingress, CORS/CSRF, Redis abuse control, authentication route, or HTTP
composition counted as complete.
Product eligibility and deterministic Product-first locking for SKU create,
activate, and resume remain future application-layer work.
