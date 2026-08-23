# Project progress

- **Overall completion:** 39%
- **Current milestone:** Identity, catalog, pricing, and inventory
- **Public demo:** Not deployable yet
- **Last reviewed:** 2026-08-24

This score covers the complete portfolio scope, including backend behavior,
frontend experience, operational hardening, and public deployment. It measures
accepted outcomes, not lines of code, generated files, commits, or activity.

## Fixed baseline

| Workstream | Weight | Earned | Current evidence |
| --- | ---: | ---: | --- |
| Architecture and contracts | 6% | 6% | Architecture overview, twenty ADRs, platform contracts, delivered Catalog public reads, accepted Catalog administration contracts, and an exact Identity/session contract now fixing Account, authenticator, Role/Permission, generation-proven AccessCredential and RefreshCredential issuance, the cross-module authenticated-principal boundary, opaque wire/digest/candidate ownership, paired cryptography, the refresh transaction capability/evidence model, confirmed-commit disclosure, atomic rotation/replay, authoritative permission, browser security, fail-closed abuse boundaries, and a sealed exact-connection execution boundary for security-critical MySQL work |
| Platform and persistence | 9% | 9% | Workspace, runtime shells, versioned routing, health, validated configuration, structured logging, strict transport boundaries, deterministic OpenAPI, one runtime-owned Prisma client, one lazy runtime-provenanced bounded allocator of one-use MariaDB connections, a supported infrastructure-only fixed-program transaction executor with opaque static statements, server-prepared binding, monotonic deadlines, explicit commit ambiguity, and no retry, a single split connection budget, coordinated cause-free shutdown, MySQL, an ordered forward-only migration history, guarded Catalog lifecycle expansion/backfill/contraction, a four-table Identity refresh-lineage schema with checked lifecycle, generation-witness, and one-active-refresh invariants now used by the private refresh transaction composition, plus authorization records with exact policy seeds, Role mappings, Account assignments, and typed retention-independent security evidence |
| Backend business capabilities | 35% | 9.85% | Catalog public reads and Product/SKU aggregates exist. Identity now has separate immutable Account, PasswordAuthenticator, Role, and SessionFamily boundaries plus versionless RefreshCredential and AccessCredential children. Creation and rotation return complete generation-matched issuance bundles; application code owns canonical redacting access/refresh wire values, copied-byte digest values, one exact frozen candidate pair, the narrow cryptography port, a fixed-policy internal Node CSPRNG/SHA-256 adapter, a pre-transaction one-shot credential-attempt verifier, digest-only refresh discovery with authentic one-use tickets, a concrete non-locking lifecycle-blind writer-MySQL discovery adapter with privately paired ticket authority, and two locked-load adapters: Prisma remains the mapping/invariant proof, while a private direct adapter executes three opaque prepared locks followed by one allowlisted post-lock clock read on the sealed executor's exact connection. A second private direct adapter consumes the authenticated reuse action, conditionally revokes the family using its complete six-field basis, and appends the exact rejected refresh event through two further prepared statements on that same connection. A third private direct adapter consumes the authenticated rotated action, performs the fixed five graph mutations, resolves authority, and appends the successful refresh event through seven prepared operations on that same connection; it copies each target digest only for its own settled insert and returns pending evidence only through workflow completion. The Prisma Bearer reader and direct-MySQL rotation projection share one bounded provider-independent authority mapper; the direct statement reads the resulting open family and current roles on the transaction's exact connection but returns only raw authority evidence for workflow-owned principal construction. Identity also has a nominal SecurityEvent identifier, the nominal authenticated-principal contract, a runtime-authentic attempt-bound refresh workflow with one decision, kind-matched persistence actions, explicitly pending transaction evidence, and an opaque one-shot closed refresh command whose fixed application orchestration binds the discovery ticket, verified attempt, generated identifiers, lifetimes, and SecurityEvent identifier before it selects exactly one terminal branch. Its internal refresh-specific Unit-of-Work port fixes the closed outcome union and a one-shot dormant completion registry that can promote or revoke only consumed evidence after scope close, without claiming database commit proof or exposing credentials. A concrete package-internal direct-MySQL Unit of Work now pairs discovery with the exact runtime, synchronously admits one command, composes the locked loader and both writers in one closed 13-statement executor program, binds database time only after the last awaited row lock, maps only the allowed transaction outcomes, promotes exact evidence only after acknowledged commit and post-seal close, and joins returned settlement with program settlement or proven non-start so late indeterminate cleanup cannot race the command. A package-internal exact-pair delivery gate now consumes one authentic rotated completion, its retained committed attempt, and the exact original candidate pair once, then returns a frozen redacting capability whose credentials, principal, and committed instants remain private. Rejected/reuse completions, foreign or equivalent pairs, structural values, Proxies, and replay cannot mint delivery authority. A complementary one-shot terminal consumer now consumes authentic committed rejection/reuse completions into frozen safe classifications while preserving rotations exclusively for delivery. A bounded writer-MySQL access-authority reader and the root-exported framework-independent resolver turn an already-extracted canonical access-wire value into one runtime-authenticated current principal or uniform rejection. A refresh-specific synchronous identifier issuer now returns one frozen, separately branded successor-refresh/access/security-event UUIDv7 bundle from the captured Node runtime capability through a restricted infrastructure subpath; it validates each result before the next provider call and exposes no generic root generator or timestamp authority. Identity still has no public refresh use case, channel-specific access-response or refresh-cookie sink, HTTP authentication adapter, or route |
| Redis, RabbitMQ, and workers | 9% | 0% | Architecture only |
| Testing, security, and resilience | 11% | 9.00% | Strict quality gates, secret-safe configuration/TLS and adversarial HTTP tests, Catalog lifecycle/Unicode tests, exhaustive Identity Account/authenticator/Role tests, adversarial session chronology/generation/expiry/replay tests, authenticated-principal tests, 137 opaque-credential/Node-adapter tests, hardened attempt/discovery/event tests, 45 refresh-workflow tests, focused closed-command and completion-settlement tests, exact refresh Unit-of-Work port/outcome-contract tests, bounded shared-authority and strict MariaDB rotation-projection tests, adversarial Bearer-resolver tests, focused Prisma refresh-discovery tests, adversarial Prisma/direct locked-loader tests, strict shared MariaDB write-envelope and workflow-authenticated reuse/rotation-writer tests, 15 focused concrete refresh Unit-of-Work tests covering closed program composition, commit-gated promotion, strict outcome evidence, non-commit mapping, cause-free defects, no-start and late-observer cleanup, failed cleanup quarantine, runtime pairing, and package-surface isolation, focused delivery-gate tests covering completion-to-attempt-to-pair authenticity, one-shot consumption, rejected/reuse/foreign/replay rejection, redaction, fixed cause-free failure, and hidden package surfaces, focused non-delivery settlement tests covering authentic rejection/reuse consumption, frozen classifications, rotated preservation, pending-evidence/clone/Proxy rejection, replay closure, and root isolation, and direct-allocator tests covering split budgets, hidden package surfaces, runtime identity, lazy allocation, live black-hole handshake closure, hard-bounded and reclaimable waiter admission, reserved-capacity enforcement, late-connection quarantine, authentic one-shot leases, stalled/failed-release quarantine, bounded active grace, terminal fail-closed shutdown, and fixed cause-free failures. The sealed transaction executor adds adversarial proofs for static statement identity and lexical placeholders, exact parameter ownership and aggregate memory bounds, server-prepared dispatch, runtime provenance, sequential/concurrent/floated operation ownership, hostile decoder and provider failures, monotonic deadlines under delayed timer callbacks, exact duplicate mapping, commit ambiguity without retry, rollback closure proof, post-BEGIN session attestation without generic clock authority, and public-surface isolation; live MySQL now proves prepared commit, rollback, an allowlisted writer-time statement, real duplicate classification, stalled-query quarantine, and replacement capacity. Executable architecture boundaries, real-MySQL Catalog lifecycle/contract suites, dedicated Identity lineage and authorization suites, an isolated authority runtime suite, isolated refresh-discovery, and a guarded refresh transaction suite covering Prisma reference locks, direct prepared locking with post-lock clock binding, production Unit-of-Work reuse/rotation commit promotion, representative outer non-commit classification and rollback, every writer-level mapped rotation constraint, full rotation graph/authority/event persistence, an established first-lock deadline that stays indeterminate, write-free, delivery-denied, and followed by recovered single-slot execution, a two-runtime competing refresh that persists one winner generation and commits one reuse-family closure, root-installed fixture-scoped statement faults across all six rotation mutations, target-statement atomicity, cumulative rollback of earlier successful writes, post-write authority-projection failure, delivery denial, and recovered capacity continue to pass. Focused Node refresh-identifier issuer tests cover exact frozen bundles, sequential target-kind validation, same-bytes cross-namespace acceptance, provider and malformed-output stop behavior, captured runtime primitives, fixed cause-free failures, and package-surface isolation. TLS-stream execution, lock/clock, post-event/pre-`COMMIT`, and escaped-scope fault injection, protocol-level commit-acknowledgement loss, and channel-specific credential sink and transport fault proofs remain future gates |
| Frontend showcase | 12% | 0% | Not started |
| Observability and operations | 5% | 1% | Sanitized liveness, bounded MySQL readiness, server-owned request identity, structured HTTP/Nest logs, redaction, and safe fatal bootstrap reporting exist; metrics and traces remain |
| CI/CD and public deployment | 8% | 1.75% | CI replays migrations idempotently and validates database, Identity-lineage, Identity-authorization, Identity-authority runtime, Identity refresh-discovery, Identity refresh transaction composition, Catalog, and API contracts against real MySQL; no release pipeline or live environment |
| Documentation and demo polish | 5% | 2.95% | README, architecture contracts including the exact authorization registry, security-evidence matrix, connection-budget rules, concrete refresh Unit-of-Work settlement lifecycle, package-internal exact-pair delivery gate, and the sealed prepared-statement/commit-ambiguity boundary, twenty ADRs, deterministic OpenAPI JSON, and a public read-only local Swagger UI exist; examples and demo guides remain |
| **Total** | **100%** | **39.55%** | Displayed overall is rounded down |

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

> Overall: 39% · Backend business capabilities: 9.85/35 · Frontend: 0/12 ·
> Deployment: 1.75/8 · Public demo: not deployable

The current committed non-delivery settlement increment earns a conservative
0.05 backend and 0.05 testing/security points, with no architecture, platform,
documentation, deployment, or CI/CD credit. One package-internal synchronous
transition now consumes an authentic committed refresh rejection or reuse
completion exactly once and returns only its frozen terminal classification.
Rotated, pending-evidence, cloned, proxied, and replayed values fail with the
existing fixed cause-free workflow error without consuming a rightful
registration.
This closes the rejected/reuse lifecycle without widening the exact-pair
credential-delivery authority or any supported package surface. There is still
no composed public refresh use case, Redis admission, channel-specific
credential delivery, HTTP composition, protected route, release pipeline, live
environment, or bounded fail-stop-quarantine observability and process-recycle
policy.
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
the DML-only grant, exact three-lock `PRIMARY FOR UPDATE` order and plans followed
by the post-lock clock read,
`.123456` preservation, retained lifecycle evidence, digest-drift not-found,
causal shared-Account first-lock contention across distinct `READ-COMMITTED`
connections, plus cause-free loopback TCP accept/handshake stall unavailability
and guarded cleanup. That network fault does not exercise an established
connection or in-flight query; the separate runtime-owned direct-connection
gate now does exercise established-query quarantine. The guarded Identity suite
now adds a causal production-Unit-of-Work first-lock deadline proof: the outcome
stays `indeterminate`, the graph stays write-free, delivery remains denied, and
an independent rotation uses recovered single-slot capacity. A bounded
same-user process-list poll positively observes the exact active production
lock before the deadline. The Prisma loader is now explicitly an invariant and
mapping proof only. The new direct scoped loader uses three opaque static
statements on the executor-owned connection, strictly
decodes the real MariaDB `meta` envelope without reading it, maps only after
statement settlement, and wipes its own digest copy independently of the
executor's parameter copy. Its live gate proves nontrivial direct numeric
mapping, prepared execution, `.123456` retention, found, and digest-drift
not-found. The adjacent direct reuse writer derives its complete
eight-parameter family condition and four-parameter event append only from the
authenticated workflow action. It recognizes exact frozen DML evidence, emits
a private runtime-authentic signal only for a zero-row family conflict, and
exposes no digest, SQL, provider cause, or package export. The live gate now
also proves a real family version-two-to-three revocation, exact null-context
rejected event, unchanged refresh/access rows, and rollback when the event
identifier collides. The adjacent rotation writer derives its full conditional
graph, authority, and successful-event material from the authenticated action,
keeps each digest copy only through its own settled insert, strictly accepts the
seven fixed statement results, and mints only pending workflow evidence. Its
live gate proves the complete graph and event, every mapped duplicate
constraint, and rollback under all three external failure classes. The database
package owns operation drain, deadline quarantine, and settlement
classification. The concrete Identity Unit of Work now composes the delivered
locked loader and both writers, maps the executor's closed outcomes, and joins
the returned database outcome with the receiver-free post-seal
program-settlement notification or synchronous proof that setup never invoked
the program. Only after both sides are ready can it promote or revoke its exact
completion. When a deadline returns `indeterminate` first, the later observer
safely retires the still-running command without changing the returned result.
The guarded live proof now composes that focused cleanup contract with an actual
Account-lock stall and verifies that lock release cannot create late writes or
revive delivery authority; the observer remains application cleanup evidence,
not commit proof.
The refresh kernel binds the exact attempt to a private transaction
scope, one locked load, one opaque decision, kind-matched terminal
persistence actions, and one exact pending-evidence value across rotation,
reuse, and rejection. Consuming that evidence is only the one-shot handoff to
private commit handling; it is neither commit proof nor credential-delivery
authority. A new package-private synchronous identifier issuer can supply the
command's separately branded successor-refresh, issued-access, and
security-event UUIDv7 values as one exact frozen bundle once composition is
implemented. Its restricted Node factory captures the runtime capability once,
validates each target kind before the next call, and has no generic root export
or ordering semantics. The new opaque command now synchronously consumes one
admission, claims its verified attempt, binds the exact activated context, and
executes the fixed load/decision/rejected-or-rotated-or-reuse sequence once. It
authenticates pending evidence before returning it. The application layer now
pre-creates a distinct dormant completion and can promote or revoke it only
after scope close; the concrete adapter alone authenticates the database
outcome and invokes that transition, but it cannot reveal credentials. The
command, workflow, port, loader, writers, and Unit of Work remain internal. They
are transaction-composed but not yet consumed by a public refresh use case. A
package-internal one-shot gate now accepts only an authentic committed rotation
and its exact original candidate pair, follows completion to the retained
committed attempt, consumes both registrations and their pair binding, and
returns one frozen redacting capability. The pair's factory registration was
already transferred synchronously and once to its first attempt before
asynchronous verification. The delivery gate refuses committed rejection or
reuse, foreign or equivalent pairs, structural values, Proxies, and replay
without returning delivery authority. A separate one-shot terminal transition
consumes only authentic committed rejection or reuse, returns its frozen safe
classification, and cannot consume a rotation or revive replay. The capability
has no raw serializer or public package subpath; the future access-response and
refresh-cookie sinks remain undelivered. The
ordered Prisma history contains Identity persistence for Account, SessionFamily,
retained refresh generations, generation-bound access, the exact permission
registry and system role, Role permission mappings, Account role assignments,
and typed security evidence.
Its checked writable refresh active slot avoids unsupported generated-column
drift while leaving MySQL as the one-active-refresh authority. Its authorization
seed is explicit, never wildcard, and the event table has closed compatible
results, typed privacy-bounded context, and no retention-coupling foreign keys.
The digest-level Prisma authority reader now consumes Account, session,
issuance, assignment, Role, mapping, and Permission records through one
bounded writer statement. It returns only a nominal current principal or one
uniform rejection, while dependency and integrity failures remain internal.
It remains package-internal and has no production HTTP composition; the new
resolver is its only public application consumer. There is still no
channel-specific credential sinks, login/refresh use case,
password-authenticator or bootstrap-state persistence, remaining security-event
adapters, Argon2 provider, password-input policy, offline command,
session-revocation transaction, trusted ingress, CORS/CSRF, Redis abuse control,
authentication route, or HTTP composition counted as complete. The direct
MariaDB allocator now suppresses network, query, parameter, packet, warning, and
debug output. Prisma driver-adapter debug/query output can still expose bound
digest arguments and must be explicitly disabled and regression-tested before
public credential ingress; that Prisma enforcement is not delivered or counted
here.
Product eligibility and deterministic Product-first locking for SKU create,
activate, and resume remain future application-layer work.
