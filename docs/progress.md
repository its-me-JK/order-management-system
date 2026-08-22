# Project progress

- **Overall completion:** 20%
- **Current milestone:** Platform and persistence foundation
- **Public demo:** Not deployable yet
- **Last reviewed:** 2026-08-22

This score covers the complete portfolio scope, including backend behavior,
frontend experience, operational hardening, and public deployment. It measures
accepted outcomes, not lines of code, generated files, commits, or activity.

## Fixed baseline

| Workstream | Weight | Earned | Current evidence |
| --- | ---: | ---: | --- |
| Architecture and contracts | 6% | 4.5% | Architecture overview, eleven ADRs, operational health, request identity/logging, RFC 9457 errors, and explicit OpenAPI/transport-validation contracts; detailed business contracts remain |
| Platform and persistence | 9% | 7.5% | Workspace, runtime shells, case-sensitive versioned routing, operational health, validated configuration, structured logging, bounded parsing, strict global DTO validation, deterministic OpenAPI, Prisma-private lifecycle facade, MySQL, migrations tooling, and integration tests |
| Backend business capabilities | 35% | 0% | No business module or endpoint implemented |
| Redis, RabbitMQ, and workers | 9% | 0% | Architecture only |
| Testing, security, and resilience | 11% | 2.75% | Strict quality gates, secret-safe configuration and TLS tests, concurrency-isolated request context, adversarial response/log/DTO tests, closed documentation aliases and package assets, parser and after-commit failure tests, lifecycle tests, and real MySQL contract tests |
| Frontend showcase | 12% | 0% | Not started |
| Observability and operations | 5% | 1% | Sanitized liveness, bounded MySQL readiness, server-owned request identity, structured HTTP/Nest logs, redaction, and safe fatal bootstrap reporting exist; metrics and traces remain |
| CI/CD and public deployment | 8% | 1.75% | CI validates API health against real MySQL; no release pipeline or live environment |
| Documentation and demo polish | 5% | 2.75% | README, architecture contracts, ADR history, deterministic OpenAPI JSON, and a public read-only local Swagger UI exist; examples and demo guides remain |
| **Total** | **100%** | **20.25%** | Displayed overall is rounded down |

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

> Overall: 20% · Backend business capabilities: 0/35 · Frontend: 0/12 ·
> Deployment: 1.75/8 · Public demo: not deployable

The current increment earns no deployment points. The self-hosted contract and
UI satisfy one release prerequisite, but there is still no release pipeline,
provider resource, live URL, synthetic showcase data, or meaningful business
vertical slice.
