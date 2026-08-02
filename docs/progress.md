# Project progress

- **Overall completion:** 13%
- **Current milestone:** Platform and persistence foundation
- **Public demo:** Not deployable yet
- **Last reviewed:** 2026-08-02

This score covers the complete portfolio scope, including backend behavior,
frontend experience, operational hardening, and public deployment. It measures
accepted outcomes, not lines of code, generated files, commits, or activity.

## Fixed baseline

| Workstream | Weight | Earned | Current evidence |
| --- | ---: | ---: | --- |
| Architecture and contracts | 6% | 3.5% | Architecture overview and eight ADRs; detailed policy and feature contracts remain |
| Platform and persistence | 9% | 4.5% | Workspace, runtime shells, MySQL, Prisma, migrations tooling, and database integration test |
| Backend business capabilities | 35% | 0% | No business module or endpoint implemented |
| Redis, RabbitMQ, and workers | 9% | 0% | Architecture only |
| Testing, security, and resilience | 11% | 1.5% | Strict quality gates, composition-root tests, and a real MySQL contract test |
| Frontend showcase | 12% | 0% | Not started |
| Observability and operations | 5% | 0% | Not started |
| CI/CD and public deployment | 8% | 1.5% | CI quality and database jobs exist; no release pipeline or live environment |
| Documentation and demo polish | 5% | 2% | README, architecture overview, and ADR history exist; OpenAPI and demo guides remain |
| **Total** | **100%** | **13%** | |

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

> Overall: 13% · Backend business capabilities: 0/35 · Frontend: 0/12 ·
> Deployment: 1.5/8 · Public demo: not deployable
