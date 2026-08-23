# Project progress

- **Overall completion:** 37%
- **Current milestone:** Identity, catalog, pricing, and inventory
- **Public demo:** Not deployable yet
- **Last reviewed:** 2026-08-23

This score covers the complete portfolio scope, including backend behavior,
frontend experience, operational hardening, and public deployment. It measures
accepted outcomes, not lines of code, generated files, commits, or activity.

## Fixed baseline

| Workstream | Weight | Earned | Current evidence |
| --- | ---: | ---: | --- |
| Architecture and contracts | 6% | 6% | Architecture overview, eighteen ADRs, platform contracts, delivered Catalog public reads, accepted Catalog administration contracts, and an exact Identity/session contract now fixing Account, authenticator, Role/Permission, generation-proven AccessCredential and RefreshCredential issuance, the cross-module authenticated-principal boundary, opaque wire/digest/candidate ownership, paired cryptography, the refresh transaction capability/evidence model, confirmed-commit disclosure, atomic rotation/replay, authoritative permission, browser security, fail-closed abuse boundaries, and exact-connection ownership for security-critical MySQL work |
| Platform and persistence | 9% | 9% | Workspace, runtime shells, versioned routing, health, validated configuration, structured logging, strict transport boundaries, deterministic OpenAPI, one runtime-owned Prisma client, one lazy runtime-provenanced bounded allocator of one-use MariaDB connections, a single split connection budget, coordinated cause-free shutdown, MySQL, an ordered forward-only migration history, guarded Catalog lifecycle expansion/backfill/contraction, an uncomposed four-table Identity refresh-lineage schema with checked lifecycle, generation-witness, and one-active-refresh invariants, plus authorization records with exact policy seeds, Role mappings, Account assignments, and typed retention-independent security evidence |
| Backend business capabilities | 35% | 9.05% | Catalog public reads and Product/SKU aggregates exist. Identity now has separate immutable Account, PasswordAuthenticator, Role, and SessionFamily boundaries plus versionless RefreshCredential and AccessCredential children. Creation and rotation return complete generation-matched issuance bundles; application code owns canonical redacting access/refresh wire values, copied-byte digest values, one exact frozen candidate pair, the narrow cryptography port, a fixed-policy internal Node CSPRNG/SHA-256 adapter, a pre-transaction one-shot credential-attempt verifier, digest-only refresh discovery with authentic one-use tickets, a concrete non-locking lifecycle-blind writer-MySQL discovery adapter with privately paired ticket authority, and a load-only Prisma adapter whose ticket boundary requires discovery's exact root writer and which consumes one ticket and locks Account, SessionFamily, and the digest-revalidated presented RefreshCredential in deterministic primary-key order without losing microseconds. Identity also has a nominal SecurityEvent identifier, the nominal authenticated-principal contract, a runtime-authentic attempt-bound refresh workflow with one decision, kind-matched persistence actions, explicitly pending transaction evidence, and an opaque one-shot closed refresh command whose fixed application orchestration binds the discovery ticket, verified attempt, generated identifiers, lifetimes, and SecurityEvent identifier before it selects exactly one terminal branch. Its internal refresh-specific Unit-of-Work port now fixes the closed outcome union and a one-shot dormant completion registry that can promote or revoke only consumed evidence after scope close, without claiming database commit proof or exposing credentials. A bounded writer-MySQL access-authority reader and the root-exported framework-independent resolver turn an already-extracted canonical access-wire value into one runtime-authenticated current principal or uniform rejection. The exact-connection allocator now has runtime provenance, but Identity still has no direct scoped loader, rotation/reuse store writer, concrete Unit of Work, database settlement, credential-delivery gate, login/refresh use case, HTTP authentication adapter, or route |
| Redis, RabbitMQ, and workers | 9% | 0% | Architecture only |
| Testing, security, and resilience | 11% | 7.95% | Strict quality gates, secret-safe configuration/TLS and adversarial HTTP tests, Catalog lifecycle/Unicode tests, exhaustive Identity Account/authenticator/Role tests, adversarial session chronology/generation/expiry/replay tests, authenticated-principal tests, 137 opaque-credential/Node-adapter tests, hardened attempt/discovery/event tests, 45 refresh-workflow tests, focused closed-command and completion-settlement tests, exact refresh Unit-of-Work port/outcome-contract tests, 35 authority-adapter tests, adversarial Bearer-resolver tests, focused Prisma refresh-discovery tests, focused locked-loader tests, and direct-allocator tests covering split budgets, hidden package surfaces, runtime identity, lazy allocation, live black-hole handshake closure, hard-bounded and reclaimable waiter admission, reserved-capacity enforcement, late-connection quarantine, authentic one-shot leases, stalled/failed-release quarantine, bounded active grace, terminal fail-closed shutdown, and fixed cause-free failures; executable architecture boundaries, real-MySQL Catalog lifecycle/contract suites, dedicated Identity lineage and authorization suites, an isolated authority runtime suite, isolated refresh-discovery and locked-loader suites, plus a real-MySQL database-runtime proof that Prisma and the separately reserved one-use connection path use the same DML principal through distinct connections, exact-stream quarantine promptly rejects an established stalled query, one-use release drains the rejected operation and returns capacity, expired waiters release queue admission, and reserve exhaustion is terminated by runtime shutdown. Transaction sequencing and drain, TLS-stream execution, pre-publication initialization cancellation, commit ambiguity, and full Unit-of-Work fault proofs remain future gates |
| Frontend showcase | 12% | 0% | Not started |
| Observability and operations | 5% | 1% | Sanitized liveness, bounded MySQL readiness, server-owned request identity, structured HTTP/Nest logs, redaction, and safe fatal bootstrap reporting exist; metrics and traces remain |
| CI/CD and public deployment | 8% | 1.75% | CI replays migrations idempotently and validates database, Identity-lineage, Identity-authorization, Identity-authority runtime, Identity refresh-discovery, Identity refresh locked-load, Catalog, and API contracts against real MySQL; no release pipeline or live environment |
| Documentation and demo polish | 5% | 2.90% | README, architecture contracts including the exact authorization registry, security-evidence matrix, connection-budget rules, refresh completion lifecycle, and commit-ambiguity boundary, ADR history, deterministic OpenAPI JSON, and a public read-only local Swagger UI exist; examples and demo guides remain |
| **Total** | **100%** | **37.65%** | Displayed overall is rounded down |

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

> Overall: 37% · Backend business capabilities: 9.05/35 · Frontend: 0/12 ·
> Deployment: 1.75/8 · Public demo: not deployable

The current application completion increment earns a conservative 0.15
backend-capability points, 0.10 testing/security points, and 0.05 documentation
points. It earns no platform, deployment, or CI/CD points: it adds no direct
transaction-scoped store, DML writer, `BEGIN`, transaction-level drain,
database commit settlement, credential delivery, HTTP composition, protected
route, release pipeline, or live environment. The preceding allocator, closed
refresh command, and Prisma locked-loader increments remain required evidence
but are not recounted.
Catalog reads are not an externally usable showcase: the endpoint is
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
application values; one internal type-only crypto port; and the root-exported
`IdentityAuthenticatedPrincipal` contract. The root now also exports
`ResolveIdentityBearerPrincipal`, its caller-facing resolution types, and one
fixed unavailable error. That framework-independent use case accepts only an
already-extracted primitive candidate, admits exact canonical access wire,
runtime-authenticates the digest and principal, and preserves the distinction
between uniform credential rejection, dependency unavailability, and internal
failure. The internal Node adapter now supplies capability-sealed asynchronous
entropy and full-wire SHA-256 with
strict provider validation and bounded cleanup. A second pre-transaction check
binds the exact candidate pair to a one-shot attempt before database work, and
digest-only discovery now returns a runtime-authentic ticket consumable once by
its matching locked loader boundary. Its concrete Prisma adapter performs one
writer-MySQL equality lookup over the copied binary digest and deliberately
applies no consumption, credential-expiry, family-expiry, revocation, or
Account-status filter. An exact empty result alone is not-found; duplicate,
orphaned, mismatched, or malformed persistence evidence fails internally. The
factory owns a hidden ticket authority and requires the exact discovery writer
client when constructing the package-internal locked loader. Over its injected
already-active transaction client, that loader consumes the ticket and issues
three separate `FORCE INDEX (PRIMARY) ... FOR UPDATE` reads in Account,
SessionFamily, presented RefreshCredential order; the last query also binds the
ticket's copied digest. It preserves six-digit database instants as canonical
strings, rehydrates lifecycle state without filtering replay evidence, wipes
the temporary digest copy, and distinguishes exact not-found, expected
unavailability, and persistence defects. Its isolated real-MySQL gate proves
the DML-only grant, exact three-statement `PRIMARY FOR UPDATE` order and plans,
`.123456` preservation, retained lifecycle evidence, digest-drift not-found,
causal shared-Account first-lock contention across distinct `READ-COMMITTED`
connections, plus cause-free loopback TCP accept/handshake stall unavailability
and guarded cleanup. That network fault does not exercise an established
connection or in-flight query; the separate runtime-owned direct-connection
gate now does exercise established-query quarantine. The Prisma loader is now
explicitly an invariant and mapping proof only. The future Unit of Work must replace its transaction
query path with a direct scoped loader recovered from the same runtime-owned
allocator, then own operation drain, cancellation, settlement, and exact-connection
quarantine. The refresh kernel binds the exact attempt to a private transaction
scope, one locked load, one opaque decision, kind-matched terminal
persistence actions, and one exact pending-evidence value across rotation,
reuse, and rejection. Consuming that evidence is only the one-shot handoff to
future commit handling; it is neither commit proof nor credential-delivery
authority. The new opaque command now synchronously consumes one admission,
claims its verified attempt, binds the exact activated context, and executes
the fixed load/decision/rejected-or-rotated-or-reuse sequence once. It
authenticates pending evidence before returning it. The application layer now
pre-creates a distinct dormant completion and can promote or revoke it only
after scope close, but it cannot authenticate a database commit or reveal
credentials. The command, workflow, port, and loader remain internal and
uncomposed before a real use case exists. The ordered Prisma history now
contains uncomposed Identity persistence for Account, SessionFamily, retained
refresh generations, generation-bound access, the exact permission registry
and system role, Role permission mappings, Account role assignments, and typed
security evidence.
Its checked writable refresh active slot avoids unsupported generated-column
drift while leaving MySQL as the one-active-refresh authority. Its authorization
seed is explicit, never wildcard, and the event table has closed compatible
results, typed privacy-bounded context, and no retention-coupling foreign keys.
The digest-level Prisma authority reader now consumes Account, session,
issuance, assignment, Role, mapping, and Permission records through one
bounded writer statement. It returns only a nominal current principal or one
uniform rejection, while dependency and integrity failures remain internal.
It remains package-internal and has no production HTTP composition; the new
resolver is its only public application consumer. There is still no locked
rotation/reuse writer, concrete Unit of Work, transaction sequencing and drain,
database-gated settlement classification, credential-delivery gate,
login/refresh use case, password-authenticator or bootstrap-state
persistence, security-event adapter, Argon2 provider, password-input policy,
offline command, session-revocation transaction, trusted ingress, CORS/CSRF,
Redis abuse control, authentication route, or HTTP composition counted as
complete. The direct MariaDB allocator now suppresses network, query, parameter,
packet, warning, and debug output. Prisma driver-adapter debug/query output can
still expose bound digest arguments and must be explicitly disabled and
regression-tested before public credential ingress; that Prisma enforcement is
not delivered or counted here.
Product eligibility and deterministic Product-first locking for SKU create,
activate, and resume remain future application-layer work.
