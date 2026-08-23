# Project progress

- **Overall completion:** 36%
- **Current milestone:** Identity, catalog, pricing, and inventory
- **Public demo:** Not deployable yet
- **Last reviewed:** 2026-08-23

This score covers the complete portfolio scope, including backend behavior,
frontend experience, operational hardening, and public deployment. It measures
accepted outcomes, not lines of code, generated files, commits, or activity.

## Fixed baseline

| Workstream | Weight | Earned | Current evidence |
| --- | ---: | ---: | --- |
| Architecture and contracts | 6% | 6% | Architecture overview, seventeen ADRs, platform contracts, delivered Catalog public reads, accepted Catalog administration contracts, and an exact Identity/session contract now fixing Account, authenticator, Role/Permission, generation-proven AccessCredential and RefreshCredential issuance, the cross-module authenticated-principal boundary, opaque wire/digest/candidate ownership, paired cryptography, the refresh transaction capability/evidence model, confirmed-commit disclosure, atomic rotation/replay, authoritative permission, browser security, and fail-closed abuse boundaries |
| Platform and persistence | 9% | 8.95% | Workspace, runtime shells, versioned routing, health, validated configuration, structured logging, strict transport boundaries, deterministic OpenAPI, one runtime-owned Prisma client, MySQL, an ordered forward-only migration history, guarded Catalog lifecycle expansion/backfill/contraction, an uncomposed four-table Identity refresh-lineage schema with checked lifecycle, generation-witness, and one-active-refresh invariants, plus authorization records with exact policy seeds, Role mappings, Account assignments, and typed retention-independent security evidence |
| Backend business capabilities | 35% | 8.4% | Catalog public reads and Product/SKU aggregates exist. Identity now has separate immutable Account, PasswordAuthenticator, Role, and SessionFamily boundaries plus versionless RefreshCredential and AccessCredential children. Creation and rotation return complete generation-matched issuance bundles; application code owns canonical redacting access/refresh wire values, copied-byte digest values, one exact frozen candidate pair, the narrow cryptography port, a fixed-policy internal Node CSPRNG/SHA-256 adapter, a pre-transaction one-shot credential-attempt verifier, digest-only refresh discovery with authentic one-use tickets, a nominal SecurityEvent identifier, the nominal authenticated-principal contract, a runtime-authentic attempt-bound refresh workflow with locked load, one decision, kind-matched persistence actions, and explicitly pending transaction evidence, plus a bounded writer-MySQL access-authority reader that resolves current principal state without an authority cache. Identity still has no locked refresh store adapter, concrete Unit of Work, committed completion, Bearer resolver/login/refresh use case, or route |
| Redis, RabbitMQ, and workers | 9% | 0% | Architecture only |
| Testing, security, and resilience | 11% | 7.25% | Strict quality gates, secret-safe configuration/TLS and adversarial HTTP tests, Catalog lifecycle/Unicode tests, exhaustive Identity Account/authenticator/Role tests, adversarial session chronology/generation/expiry/replay tests, authenticated-principal tests, 137 opaque-credential/Node-adapter tests, hardened attempt/discovery/event tests, 45 refresh-workflow tests, and 35 authority-adapter tests covering one-statement SQL, digest cleanup, relational mapping, rejection/failure taxonomy, malformed output, and exact bounds; executable architecture boundaries, real-MySQL Catalog lifecycle/contract suites, dedicated Identity lineage and authorization suites, plus an isolated authority runtime suite proving current Role/Permission visibility, consumed-refresh and idle-expiry semantics, indistinguishable rejection, cross-row corruption, clipped access lifetime, the exact 2,048-row ceiling, and real outage classification |
| Frontend showcase | 12% | 0% | Not started |
| Observability and operations | 5% | 1% | Sanitized liveness, bounded MySQL readiness, server-owned request identity, structured HTTP/Nest logs, redaction, and safe fatal bootstrap reporting exist; metrics and traces remain |
| CI/CD and public deployment | 8% | 1.75% | CI replays migrations idempotently and validates database, Identity-lineage, Identity-authorization, Identity-authority runtime, Catalog, and API contracts against real MySQL; no release pipeline or live environment |
| Documentation and demo polish | 5% | 2.8% | README, architecture contracts including the exact authorization registry and security-evidence matrix, ADR history, deterministic OpenAPI JSON, and a public read-only local Swagger UI exist; examples and demo guides remain |
| **Total** | **100%** | **36.15%** | Displayed overall is rounded down |

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

> Overall: 36% · Backend business capabilities: 8.4/35 · Frontend: 0/12 ·
> Deployment: 1.75/8 · Public demo: not deployable

The current internal authority increment earns 0.25 backend-capability points
and 0.20 testing/security points. It earns no deployment points because no
Bearer resolver, HTTP composition, or live environment consumes it. Catalog
reads are not an externally usable showcase: the endpoint is
production-composed locally, but there is still no release pipeline, provider
resource, live URL, synthetic showcase data, distributed abuse control, or
database-side query deadline.
The Catalog persistence contract now represents the aggregate lifecycle and
has a real prior-release upgrade proof, but no administrative route, write use
case, audit/idempotency storage, or coordinating Unit of Work is counted as
complete. Identity currently stops at non-exported Account,
PasswordAuthenticator, Role, PermissionCode, SessionFamily,
RefreshCredential, and AccessCredential domain slices with complete atomic
creation/rotation results; strict opaque wire, digest, and paired-candidate
application values; one internal type-only crypto port; and one root-exported
type-only `IdentityAuthenticatedPrincipal` contract. The internal Node adapter
now supplies capability-sealed asynchronous entropy and full-wire SHA-256 with
strict provider validation and bounded cleanup. A second pre-transaction check
binds the exact candidate pair to a one-shot attempt before database work, and
digest-only discovery now returns a runtime-authentic ticket consumable once by
its matching locked loader boundary. The refresh kernel now binds that exact
attempt to a private transaction scope, one locked load, one opaque decision,
kind-matched terminal persistence actions, and one exact pending-evidence value
across rotation, reuse, and rejection. Consuming that evidence is only the
one-shot handoff to future commit handling; it is neither commit proof nor
credential-delivery authority. The workflow remains internal and uncomposed
before a real use case exists. The ordered Prisma history now contains
uncomposed Identity persistence for Account, SessionFamily, retained refresh
generations, generation-bound access, the exact permission registry and system
role, Role permission mappings, Account role assignments, and typed security
evidence.
Its checked writable refresh active slot avoids unsupported generated-column
drift while leaving MySQL as the one-active-refresh authority. Its authorization
seed is explicit, never wildcard, and the event table has closed compatible
results, typed privacy-bounded context, and no retention-coupling foreign keys.
The digest-level Prisma authority reader now consumes Account, session,
issuance, assignment, Role, mapping, and Permission records through one
bounded writer statement. It returns only a nominal current principal or one
uniform rejection, while dependency and integrity failures remain internal.
It is deliberately package-internal and uncomposed. There is still no locked
refresh store adapter, concrete Unit of Work, committed completion, Bearer
resolver/login/refresh use case, password-authenticator or bootstrap-state
persistence, security-event adapter, Argon2 provider, password-input policy,
offline command, session-revocation transaction, trusted ingress, CORS/CSRF,
Redis abuse control, authentication route, or HTTP composition counted as
complete.
Product eligibility and deterministic Product-first locking for SKU create,
activate, and resume remain future application-layer work.
