# Identity and session contract

## Scope and delivery gate

This contract defines the first administrator identity boundary for the
modular monolith. It covers accounts, password credentials, roles,
permissions, opaque sessions, browser and CLI transport, MySQL authority,
Redis abuse control, revocation, fixed failures, and the exact HTTP surface.

It does not define public customer identity, registration, self-service
password recovery, invitations, MFA, service accounts, API keys, social login,
OIDC federation, impersonation, or an administrator user interface. Those
capabilities require separate threat models and contracts. It does define the
narrow offline operator rebind needed after the password authenticator reaches
its mandatory failed-attempt limit; that is recovery of an existing
administrator authenticator, not a public recovery surface.

The backend contract can support a token-mediating browser client, but an
access credential visible to JavaScript remains stealable during XSS. A full
Backend for Frontend is the default recommendation for the privileged UI. No
such UI ships until a separate threat-model decision selects that pattern or
explicitly accepts the bounded token-mediating risk. The public showcase
continues to publish no administrator credential.

No route in this document exists yet. The four Identity routes and the first
administrative route may be registered only after all of these capabilities
are implemented and integration-tested together:

- the framework-independent Identity domain and application package;
- a reviewed forward-only MySQL migration and authoritative principal query;
- cryptographic token and Argon2id adapters plus offline first-admin and
  disabled-authenticator rebind commands, with no default or showcase
  credentials;
- an explicit Identity Unit of Work for login, rotation, reuse revocation,
  logout, and security events;
- a real Redis runtime and atomic Identity abuse-control adapter;
- reviewed trusted-ingress, exact credentialed CORS, cookie, Origin, Fetch
  Metadata, and CSRF behavior;
- the fixed Bearer `401`, authorization `403`, and Identity-owned cookie clear
  path in Problem Details and OpenAPI;
- secret-safe logs, immutable security events, bounded cleanup, and operational
  metrics; and
- real MySQL, real Redis, HTTP, concurrency, failure, and production-composition
  tests proving the complete contract.

There is no development bypass, shared API key, hard-coded administrator,
caller-supplied principal, or configuration switch that skips a gate. The
transport choice is owned by
[ADR-0017](../adr/0017-use-split-browser-session-credentials.md); the broader
authorization decision remains
[ADR-0015](../adr/0015-authenticate-and-authorize-administrative-apis.md).

## Security and consistency objectives

The boundary follows these priorities:

1. A stolen refresh credential is detectable and revocable without storing a
   recoverable copy.
2. Suspension, revocation, password replacement, and permission changes affect
   the next privileged request.
3. Passwords, raw credentials, login identifiers, cookies, and network
   identifiers never enter logs or business modules.
4. Browser CSRF cannot cause credential issuance, rotation, or logout.
5. Password guessing and credential stuffing are bounded across replicas
   before expensive Argon2id work.
6. Dependency ambiguity never results in a new credential.

MySQL is the system of record. Redis may deny or defer credential issuance but
cannot authenticate a principal, grant a permission, keep a session alive, or
prove revocation.

## Module and dependency boundary

```mermaid
flowchart LR
    Browser[Browser or CLI] --> HTTP[Identity HTTP adapter]
    HTTP --> UseCases[Identity application use cases]
    UseCases --> Domain[Account, Role, and SessionFamily]
    UseCases --> Abuse[AbuseControl port]
    UseCases --> UoW[Identity Unit of Work]
    Abuse --> Redis[(Redis)]
    UoW --> MySQL[(MySQL)]
    HTTP --> Resolver[Bearer principal adapter]
    Resolver --> MySQL
    Resolver --> Principal[Opaque authenticated principal]
    Principal --> Catalog[Catalog application command]
```

The business package is `@oms/identity` under `packages/modules/identity`.
Its root exports application use cases, ports, typed outcomes, and the
authenticated-principal contract only. Domain types remain package-internal;
an empty root is preferable to exposing an aggregate before an application
contract exists. Domain and application code import no NestJS, Prisma, Redis
client, Node crypto, HTTP, or logging vendor.

Infrastructure adapters use explicit subpaths such as
`@oms/identity/infrastructure/prisma`. Prisma construction stays in the API
composition root. Delivery belongs under
`apps/api/src/features/identity/delivery/http`; reusable Bearer extraction and
request association belong to the API authentication platform adapter.

The adapter resolves authority and associates an immutable principal with the
request. A business delivery adapter maps that value into its own command
context. Catalog never imports an Identity repository, role, account, or
credential and never queries an Identity table.

The principal contains exactly:

- canonical opaque `actorId`;
- canonical opaque `sessionId`; and
- a distinct, lexicographically sorted permission-code set.

It contains no login name, role name, account status, password metadata,
credential identifier, raw token, digest, cookie, IP address, or user agent.
The resolver fails closed if the result exceeds 16 active roles or 128
distinct permissions; those bounds prevent corrupt configuration from making
authority an unbounded request input.

## Domain boundaries and lifecycle

| Boundary | Ownership and invariants |
| --- | --- |
| `Account` aggregate | Canonical login, `ACTIVE`, `SUSPENDED`, or terminal `DEACTIVATED`, and optimistic version. Roles and password state are not loaded into this aggregate. |
| `PasswordAuthenticator` aggregate | One account key, `ACTIVE` or `REBIND_REQUIRED`, Argon2id PHC value, optimistic version, bounded consecutive failures, and the next permitted verification instant. It is separate because rejected login mutates this hot state without changing Account. |
| `Role` aggregate | Immutable code, display name, `ACTIVE` or terminal `RETIRED`, optimistic version, and a bounded permission set. |
| `SessionFamily` aggregate | Stable session identifier, one account, absolute and idle deadlines, revocation, and only the current command's presented/successor refresh entities. It never loads complete token history. |
| `Permission` reference | Immutable application-owned permission code seeded by a reviewed migration. |
| `SecurityEvent` record | Append-only evidence with closed event and reason codes; it is not a mutable aggregate. |
| Authority read model | One purpose-built current-state projection returning only the authenticated principal. |

An active account may be suspended and resumed. Active or suspended accounts
may be deactivated; deactivation is terminal. Suspension, deactivation, and
password replacement revoke all active session families in the same
transaction. Roles may be retired but not restored. Role and permission
changes become visible through the next authority read and do not mutate token
records.

The first Account slice defines and rehydrates exactly these
persistence-facing fields:

| Field | Domain rule |
| --- | --- |
| `id` | Canonical lowercase UUIDv7. |
| `loginName` | Canonical 3-through-64-character ASCII login while the account is active or suspended; it may be `null` only after a separately versioned erasure of a deactivated account. |
| `status` | `ACTIVE`, `SUSPENDED`, or terminal `DEACTIVATED`. |
| `version` | Positive unsigned 32-bit optimistic version; creation is version 1 and every lifecycle transition advances it once. |
| `createdAt`, `updatedAt` | MySQL-range UTC instants with exactly six fractional digits; time never regresses and creation initializes both to the same value. |
| `suspendedAt` | Current-state marker. It equals `updatedAt` while suspended and is cleared by resume or deactivation; historical suspensions belong in security events. |
| `deactivatedAt` | Terminal marker. It is `null` before deactivation, equals `updatedAt` on the terminal transition, and remains the original deactivation time after later erasure. |

The currently reachable snapshots are deliberately narrower than the future
table: Active is version 1 or an odd version from 3 onward, Suspended is an
even version from 2 onward, and Deactivated may be any version from 2 onward.
A deactivated account retaining its login is unchanged since the terminal
transition, so `deactivatedAt` equals `updatedAt`. A retention tombstone has a
null login, version 3 or later, and may have a later `updatedAt`; the version
advance makes erasure visible to optimistic concurrency even though the
business lifecycle remains terminal. Snapshot rehydration rejects missing or
unknown fields, invalid chronology, and impossible lifecycle combinations.
This slice exposes no erasure command; the retention policy and its security
event remain a later contract.

Account creation and lifecycle methods return a new immutable aggregate plus
a frozen, login-free in-process domain fact. These facts are not
`identity_security_events`, integration events, or permission to publish.
The future application Unit of Work maps them to closed security-event rows
and performs required session-family revocation in the same MySQL transaction.
Optimistic version is checked before lifecycle state, mutation time is checked
after lifecycle state, and version capacity is checked last; this fixes stable
failure precedence without accepting stale commands or regressing time.

### Role and permission state contract

A permission code is a stable application-owned policy identifier, not
operator-authored content. It has exactly three dot-separated ASCII segments
representing bounded context, resource, and action. Every segment starts with a
lowercase letter, contains only lowercase letters, digits, or single internal
hyphens, and is at most 32 characters; the complete code is at most 98
characters. Empty segments, underscores, consecutive or edge hyphens,
wildcards, surrounding whitespace, case folding, and silent normalization are
rejected. This intentionally supports codes such as
`catalog.product-variants.read` without admitting wildcard policy semantics.
The application layer later verifies that a syntactically valid code exists in
the immutable permission registry before Role creation, grant, or revoke. This
makes a syntactically valid typo an explicit application failure instead of a
silent absent-mapping no-op; the foreign key remains the final write backstop.

The Role snapshot contains exactly `id`, `code`, `displayName`, `status`,
`permissions`, `version`, `createdAt`, `updatedAt`, and `retiredAt`:

| Field | Domain rule |
| --- | --- |
| `id` | Canonical lowercase UUIDv7. |
| `code` | Immutable 3-through-64-character uppercase ASCII identifier with single internal underscores; uniqueness is enforced transactionally by persistence. |
| `displayName` | Operator-facing NFC Unicode text from 1 through 100 code points, with only non-repeated internal U+0020 spaces and no surrogate, control, format, private-use, or unassigned code point. It is never authorization input. |
| `status` | `ACTIVE` or terminal `RETIRED`; a retired role cannot be renamed or have its mappings changed. |
| `permissions` | Frozen, distinct, ASCII-lexicographically sorted permission codes, with cardinality from 0 through 128. An empty active role safely grants nothing. |
| `version` | Positive unsigned 32-bit optimistic version; creation is version 1 and every effective rename, mapping change, or retirement advances it once. |
| `createdAt`, `updatedAt` | Lossless MySQL-range UTC instants; creation initializes both to the same value and time never regresses. |
| `retiredAt` | `null` while active; equal to `updatedAt` after the terminal transition. |

Creation accepts permissions in any order, rejects duplicate entries as a
caller/configuration defect, and stores the canonical sorted set. Rehydration
is stricter: it rejects extra or missing snapshot fields and any permission
array that is not already distinct and sorted, so persistence corruption is
not silently repaired. An Active version-1 snapshot has
`createdAt = updatedAt` and no retirement time. A Retired snapshot has version
at least 2 and `retiredAt = updatedAt`. Equal mutation instants remain valid
because the version is the concurrency order.

Role exposes explicit `grantPermission` and `revokePermission` operations
instead of replacing the complete set. That prevents a stale administrator
from accidentally overwriting unrelated grants and produces one precise audit
fact per effective change. Granting an existing or revoking an absent
permission, and renaming to the current display name, returns the original
aggregate unchanged, consumes no version, and emits no fact. Removing the last
permission is allowed; retiring a role is a separate terminal business
decision. This deliberately permits a temporarily empty Active role: it is
operationally visible but grants nothing, while forcing retirement would make a
temporary least-privilege response irreversible. Account-role assignments
remain outside both Account and Role so their independent hot paths do not
create oversized aggregates.

Every mutation validates expected version, Active lifecycle, and its new value
before deciding whether it is a no-op. Effective changes then validate
occurrence time and permission capacity where applicable, followed by version
capacity. This stable precedence rejects stale commands first while allowing a
semantic no-op carrying the current expected version to succeed without
requiring a new database time. A replay carrying the pre-change version still
fails optimistic concurrency; durable command idempotency owns lost-response
replay. Changed operations return a new immutable Role and a frozen fact
tuple. Creation emits `ROLE_CREATED` followed by one
`ROLE_PERMISSION_GRANTED` fact per initial mapping in canonical order; every
other effective operation emits one fact and unchanged operations emit none.
Facts contain only type, opaque role ID, resulting status, version, occurrence
time, and—for a mapping change—the non-secret permission code; display names
and complete permission sets are excluded. They are inputs to the future
application Unit of Work, not integration events or permission to publish.

Because Unicode normalization does not prevent homoglyphs, every
administrator-facing role selector or confirmation renders the immutable ASCII
role code beside the display name. The application contract must also define
reserved `SYSTEM_` code ownership and last-administrator protection before any
remote role-management route is enabled; those cross-aggregate policies do not
belong inside Role.

The alternative is a generic RBAC entity with mutable role names and bulk
mapping replacement. It is simpler to scaffold but makes role labels part of
business policy, expands lost-update risk, and obscures audit intent. The
chosen aggregate costs more explicit commands and requires the future Unit of
Work to check the permission registry and persist a Role row plus mapping
delta atomically. In return, business modules depend only on stable permission
codes, authority remains least-privilege, and role retirement preserves
evidence without creating a permanent wildcard administrator.

### PasswordAuthenticator state contract

The PasswordAuthenticator snapshot contains exactly `accountId`,
`passwordPhc`, `status`, `version`, `consecutiveFailureCount`,
`nextVerificationAt`, `disabledAt`, `createdAt`, `updatedAt`, and
`passwordChangedAt`. The PHC is held by an immutable redacting value rather
than a string property; only an explicitly named package-internal serializer
may reveal it to the future crypto and persistence adapters. Ordinary object
inspection, interpolation, and JSON serialization cannot reveal the PHC.

| State | Reachable snapshot |
| --- | --- |
| Fresh `ACTIVE` | Version 1, count 0, no deadline or disabled time, and `createdAt = updatedAt = passwordChangedAt`. |
| `ACTIVE`, count 0 through 4 | No deadline or disabled time. A positive count requires version at least `count + 1`. |
| `ACTIVE`, count 5 through 99 | No disabled time and `nextVerificationAt` equals `updatedAt + min(2^(count - 5), 900) seconds` exactly. A positive count requires version at least `count + 1`. |
| `REBIND_REQUIRED` | Count exactly 100, no deadline, `disabledAt = updatedAt`, and version at least 101. |

Every state requires `createdAt <= passwordChangedAt <= updatedAt`. Equal
authoritative database instants are valid because the version orders
mutations. Cooldown derivation uses lossless Gregorian calendar arithmetic and
retains all six fractional digits; JavaScript `Date` is never an input. A
deadline beyond MySQL's maximum instant is a fixed overflow failure and leaves
the original aggregate unchanged. Attempt 100 performs no deadline
calculation.

Before Argon2 work, the aggregate returns only one of two frozen plans:
`VERIFY_PRESENTED_PASSWORD` or `VERIFY_DUMMY_PASSWORD`. Cooling and
`REBIND_REQUIRED` authenticators use the same dummy plan, so delivery cannot
infer a reason from the type. A real plan contains a frozen internal
verification basis with account ID, version, redacting PHC, and current
deadline. After work completes, the locked aggregate must match that complete
basis before accepting the result. One fixed snapshot-mismatch failure covers
version, PHC, deadline, and cross-account races; it never reveals which value
changed.

An eligible failed verification increments the count and version once.
Failures 1 through 99 return one `PASSWORD_VERIFICATION_REJECTED` fact. Failure
100 atomically enters `REBIND_REQUIRED` and returns that fact followed by
`PASSWORD_AUTHENTICATOR_DISABLED`. Recording a result while cooling or
disabled is a fixed misuse/race failure, not a no-op; the normal login path did
dummy work and never calls the mutation.

An eligible successful verification resets any positive count and deadline.
It may also install a byte-different, already-validated upgraded PHC in the
same single-version mutation. A verifier upgrade does not change
`passwordChangedAt`. If there is neither state to reset nor a real upgrade,
the operation returns the original aggregate unchanged, emits no fact, and
does not consume version capacity. Changed results emit
`PASSWORD_AUTHENTICATOR_FAILURES_RESET` then
`PASSWORD_AUTHENTICATOR_VERIFIER_UPGRADED` for the changes that occurred.

Rebind requires the exact expected version, `REBIND_REQUIRED`, a
non-regressing database instant, and a byte-different validated PHC. It returns
the authenticator to `ACTIVE`, clears count/deadline/disabled time, advances
the version once, sets `updatedAt = passwordChangedAt`, and emits
`PASSWORD_AUTHENTICATOR_REBOUND`. Active Account validation, session-family
revocation, and the durable rebind security event remain responsibilities of
the future application Unit of Work.

All authenticator facts are frozen and contain only type, opaque account ID,
resulting status, version, and occurrence time. They contain no PHC, password,
candidate, salt, tag, verifier parameters, count, deadline, or disabled time.
The stable mutation precedence is verification basis—or expected version for
rebind—then required lifecycle, occurrence time and cooldown eligibility, new
PHC validation where applicable, version capacity, and derived-deadline
overflow. Rehydration collapses every malformed secret or state cause to one
fixed, cause-free snapshot error.

### SessionFamily core state contract

SessionFamily owns the durable lifetime and terminal revocation of one login
session. Expiry is derived from authoritative time and is never persisted as a
status. The first bounded implementation deliberately excludes refresh
rotation: rotation lands only with the locked presented-credential and
successor entities so consuming a predecessor, linking its successor, moving
the family deadline, and detecting replay cannot become separate partial
operations.

The family snapshot contains exactly `id`, `accountId`, `version`, `createdAt`,
`lastRotatedAt`, `refreshIdleExpiresAt`, `refreshAbsoluteExpiresAt`,
`revokedAt`, and `closedReason`:

| Field | Domain rule |
| --- | --- |
| `id` | Externally visible canonical lowercase UUIDv7, branded separately from Account, Role, and credential identifiers. |
| `accountId` | Canonical owning Account identifier; ownership never changes. |
| `version` | Positive unsigned 32-bit version. Creation is version 1; every effective rotation or revocation advances it once. |
| `createdAt`, `lastRotatedAt` | Lossless MySQL-range UTC instants. Creation makes them equal; rotation may use an equal database instant but never an earlier one. |
| `refreshIdleExpiresAt` | Strictly after `lastRotatedAt`, no more than 24 hours later, and no later than the absolute deadline. It gates refresh only. |
| `refreshAbsoluteExpiresAt` | Exactly 1 through 30 whole days after creation and immutable for the complete family. It gates refresh and every access credential. |
| `revokedAt`, `closedReason` | Both null or both present. Revocation time is not before `lastRotatedAt`; the first reason and time are terminal and may be recorded after either deadline. |

The initial refresh-idle lifetime is an integer from 900 through 86,400
seconds, the absolute lifetime is an integer from 86,400 through 2,592,000
seconds, and idle cannot exceed absolute. Creation derives both deadlines from
one database instant with Gregorian, microsecond-preserving arithmetic and no
JavaScript `Date`. An absolute deadline beyond MySQL year 9999 is a fixed
overflow failure. Version-1 open families and version-2 families revoked
without rotation retain `createdAt = lastRotatedAt` and the initial lifetime
bounds. `REFRESH_REUSE_DETECTED` is reachable only on a revoked version-3-or-
later family because consuming the predecessor and installing its successor
must have advanced the family before replay can be concluded. A retained
rotated snapshot has at least one whole second and at most 24 hours from its
last rotation to its idle deadline. When the idle deadline is before the
absolute deadline, the configured 15-minute minimum still applies; the one-
second minimum applies only when the idle deadline equals the earlier absolute
cap.

Version also constrains when the retained last rotation could have happened.
An open version `v` records `v - 1` rotations; a revoked version records
`v - 2`, with revocation consuming the other post-creation version. For one
through 29 rotations, `lastRotatedAt` must be strictly before `createdAt` plus
that count multiplied by 24 hours: every predecessor had an idle deadline no
more than 24 hours after its rotation, and refresh at that deadline is already
expired. At 30 or more rotations, `lastRotatedAt < refreshIdleExpiresAt <=
refreshAbsoluteExpiresAt` and the 30-day absolute maximum already impose the
stronger bound. This rejects a row claiming one late rotation weeks after its
only possible predecessor had expired without retaining complete history.

At one authoritative observation instant, the derived family state is:

1. `REVOKED` when the terminal pair is present;
2. otherwise `ABSOLUTELY_EXPIRED` when observation is equal to or after the
   absolute deadline; or
3. otherwise `AUTHENTICATING`.

Idle expiry is intentionally absent from that state. An access credential may
remain valid after refresh inactivity until its own expiry or the family
absolute deadline. Observation before the current mutation high-water mark
(`revokedAt` when present, otherwise `lastRotatedAt`) is a fixed clock-
regression failure, not a historical query.

The initial closed-reason registry is exactly `LOGOUT`,
`SESSION_LIMIT_REACHED`, `ACCOUNT_SUSPENDED`, `ACCOUNT_DEACTIVATED`,
`PASSWORD_REPLACED`, `PASSWORD_REBOUND`, and `REFRESH_REUSE_DETECTED`. Generic
revocation accepts every listed reason except `REFRESH_REUSE_DETECTED`; only
the future consumed-credential branch may establish that security conclusion.
Generic revocation is server-coordinated from the current locked family and
therefore takes no client or discovery-time expected version. The first
effective caller advances the version and emits `SESSION_FAMILY_REVOKED`; a
later caller reloads the terminal row, returns it unchanged, and cannot replace
the first reason. Persistence still compares or locks the versioned row.

Creation and effective revocation return a new immutable family and a frozen
nonempty fact tuple; unchanged revocation returns the original family and an
empty frozen tuple. Facts contain only type, opaque session and account IDs,
derived state, resulting version, occurrence time, and the closed reason when
applicable. Deadlines, raw credentials, digests, credential IDs, sequences,
cookies, network attributes, and user-agent data are excluded. Rehydration
requires exact fields and collapses every malformed value, chronology,
lifetime, and lifecycle cause to one fixed cause-free error.

The alternative is a stored `ACTIVE`/`EXPIRED` flag or a family-only rotation
method. A stored expiry flag becomes stale without a write at every deadline;
a partial rotation method could extend a family without consuming the refresh
row. Deriving expiry and deferring rotation costs one additional domain
increment, but preserves one authoritative clock and makes the future
consume/link/extend/replay decision atomic.

The next refresh-entity slice starts sequences at 1 and rehydrates only the
specific locked predecessor needed by the command. Non-locking digest discovery
may return identifiers only: the transaction must reload current family and
credential state. In a two-refresh race, the loser must see the predecessor as
consumed and revoke the now-newer family; rejecting a stale discovery-time
version would suppress replay detection. Raw token values and digests never
enter either aggregate.

An account has at most five authenticating session families, where
authenticating means unrevoked and before absolute expiry; refresh idle expiry
does not make a still-valid access credential disappear. Login holds the
Account lock and, when the limit is reached, revokes the oldest family by
`(createdAt, id)` with reason `SESSION_LIMIT_REACHED` before inserting the new
family. A concurrent login therefore serializes on Account and cannot exceed
the cap. Any selected family rows are locked in UUID order even though oldest
selection uses creation order.

Failed logins never suspend or deactivate the Account aggregate and do not
revoke an already-authenticated session. The password authenticator retains a
counter capped at 100 and a capped next-verification deadline. On the 100th
consecutive failure it transitions to `REBIND_REQUIRED`; login then performs
only dummy verification for that authenticator until the offline rebind
workflow replaces it. This is durable defense if Redis state is evicted and
meets the current NIST ceiling. It also creates a deliberate operator-recovery
denial-of-service risk for a known login, which the much lower distributed
limits make expensive and observable.

## Persistence design

Identity owns `packages/database/prisma/identity.prisma` and the corresponding
tables. Prisma models are persistence records, not domain objects. The
migration owns ASCII binary collations, checks, generated columns, index
direction, and constraint names that Prisma cannot express.

All identifiers are application-generated UUIDv7 stored as `BINARY(16)`. All
application timestamps are UTC `DATETIME(6)`. Codes, states, login names,
credential digests, and PHC values use byte-exact representations. Foreign
keys use `RESTRICT`; deletion and retention are explicit workflows rather than
cascades.

Identity repositories preserve all six timestamp digits with reviewed
parameterized SQL and lossless string projections such as
`DATE_FORMAT(value, '%Y-%m-%dT%H:%i:%s.%fZ')`. Prisma's ordinary JavaScript
`Date` materialization is not used for aggregate hydration, authoritative
database time, deadline comparison, or credential issuance because it would
truncate the final three microsecond digits. Real-MySQL tests must distinguish
otherwise-equal values that differ only in those digits.

| Table | Required shape and indexes |
| --- | --- |
| `identity_accounts` | UUID primary key; nullable-after-erasure canonical `login_name VARCHAR(64)` with ASCII binary unique index and format check; status; unsigned version; created, updated, suspended, and deactivated timestamps with lifecycle checks. |
| `identity_password_credentials` | `account_id` primary/foreign key; `ACTIVE` or `REBIND_REQUIRED`; `password_phc VARCHAR(255)` using ASCII binary comparison; consecutive-failure count from 0 through 100; optional `next_verification_at` and `disabled_at`; unsigned version; created, updated, and password-changed timestamps. `REBIND_REQUIRED` requires count 100, a disabled time, and no verification deadline. The row is the `PasswordAuthenticator` aggregate. The PHC value already contains algorithm, cost, salt, and hash. |
| `identity_permissions` | Immutable lowercase permission code natural primary key and fixed description; initially seeded with the codes accepted in ADR-0015. |
| `identity_roles` | UUID primary key; immutable unique ASCII code; display name; status; unsigned version and lifecycle timestamps. |
| `identity_role_permissions` | Composite primary key `(role_id, permission_code)` plus reverse `(permission_code, role_id)` index. |
| `identity_account_roles` | Composite primary key `(account_id, role_id)` plus reverse `(role_id, account_id)` index. |
| `identity_session_families` | Externally visible UUID session ID; account ID; unsigned version; created, last-rotated, idle-expiry, absolute-expiry, optional revoked time and closed reason. Indexes `(account_id, revoked_at, absolute_expires_at, id)` and `(absolute_expires_at, id)`. Expiry is derived from time, not a stored status. |
| `identity_access_credentials` | UUID primary key; family ID; unique `BINARY(32)` digest; issued and expiry times. Indexes `(family_id, expires_at, id)` and `(expires_at, id)`. Validity derives from credential, family, and account state. |
| `identity_refresh_credentials` | UUID primary key; family ID; unique `BINARY(32)` digest; unsigned sequence; issued, expiry, optional consumed time and optional unique successor ID. Unique `(family_id, sequence)`. A generated active-slot column plus unique `(family_id, active_slot)` enforces at most one unconsumed credential per family. |
| `identity_security_events` | UUID, closed event/outcome/reason codes, optional opaque actor/subject/session/request/correlation IDs, and occurrence time. It has no arbitrary JSON and no foreign key to account or session retention. Indexes support time, subject-time, and session-time queries. |
| `identity_bootstrap_state` | One seeded singleton row locked by first-admin provisioning so two concurrent commands cannot both claim bootstrap. |

The permission migration seeds exactly the seven codes in ADR-0015 and one
built-in `SYSTEM_ADMINISTRATOR` role containing exactly those seven mappings:

- `catalog.products.read`
- `catalog.products.write`
- `catalog.products.publish`
- `catalog.skus.read`
- `catalog.skus.write`
- `catalog.skus.publish`
- `audit.records.read`

The complete application-owned permission registry is capped at 128 codes.
Every permission-adding migration must assert that bound before inserting. It
keeps a principal's distinct-permission projection intrinsically bounded; with
at most 16 active roles, the authority query still caps and validates at most
2,048 mapping rows before producing at most 128 codes. Exceeding either bound
is corruption and fails closed, not partial authority.

The role never means “all permissions.” A future permission is not granted
until a reviewed migration or authorization command explicitly adds that
mapping. First-admin provisioning locks the bootstrap singleton, proves no
bootstrap account was previously claimed, creates Account and
PasswordAuthenticator, assigns this role, appends the bootstrap security
event, and marks the singleton claimed in one transaction. It issues no
session credential.

### Offline administrator credential operations

First-admin provisioning and password-authenticator rebind are commands in the
same built API artifact as `identity:bootstrap-admin` and
`identity:rebind-password`, but they are never NestJS providers, controllers,
RabbitMQ consumers, scheduled jobs, or remotely triggerable application routes.
They run only as an explicit one-shot administrative process inside the private
deployment environment. The trust boundary is the deployment control plane's
authenticated operator session, audit log, and authority to inject the
production database secret. Possession of a public API credential is neither
required nor sufficient. The application records a non-secret
operator/change reference matching
`[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}` for correlation, while the control-plane
audit is the authoritative operator identity record.

Neither command accepts an administrator password or login name through
command-line arguments, environment variables, a process title, or a
configuration file. The database connection still comes from the ordinary
secret configuration boundary. Interactive execution reads the login where
needed and reads the password twice from a hidden TTY. It refuses redirected
standard input. Explicit non-interactive execution instead reads one strict,
at-most-2-KiB JSON object from a caller-specified already-open file descriptor
backed by a control-plane secret or pipe; terminal descriptors, ordinary
filesystem paths, unknown members, trailing bytes, and repeated reads are
rejected. Bootstrap input contains exactly `login`, `password`, and
`operatorReference`; rebind input contains exactly `password`, while its
non-secret target, version, and reference remain options. The descriptor is
closed after one read and the input buffer is released as soon as hashing
permits. Output and failures contain only fixed status text plus opaque account,
event, and execution identifiers—never login, password, PHC, candidate,
database URL, or vendor error.

First-admin provisioning accepts exactly a login, new password, and bounded
operator/change reference through that input boundary. It validates the normal
login and password-establishment policy, calculates Argon2id before its
transaction, then performs the bootstrap transaction above. It refuses an
already-claimed singleton and never overwrites an account.

Rebind requires an account UUID, expected authenticator version, and bounded
operator/change reference as non-secret options; interactive execution also
requires the operator to re-enter the account UUID before reading a new
password. It calculates the validated new PHC outside the transaction, then
locks Account, PasswordAuthenticator, and the bounded authenticating families
in the global order. It requires an active account, the exact expected version,
and `REBIND_REQUIRED`; replaces the PHC, returns the authenticator to `ACTIVE`,
zeros failures and the deadline, increments the version, revokes every active
family with reason `PASSWORD_REBOUND`, and appends one rebind event in a single
transaction. It issues no session. A target mismatch or already-active
authenticator is a fixed refusal, never an upsert. The runbook requires a fresh
login afterward and correlation of the application event with the deployment
audit record.

The authority query starts from a unique access digest and inner-joins the
unexpired credential, unrevoked family before its absolute expiry, and active
account. It then left-joins active role assignments and permissions in the same
bounded SQL statement using one MySQL `CURRENT_TIMESTAMP(6)` value selected in
that statement. Zero
active roles is a valid authenticated principal with `permissions: []`, not an
authentication failure; a protected business command subsequently returns its
ordinary permission `403`. The 16-role bound counts distinct non-null active
roles, and the 128-permission bound counts distinct non-null codes before
returning the sorted set. This also lets `GET /auth/session` succeed after the
last role is revoked. Refresh idle expiry is not part of Bearer resolution: it
prevents another refresh but does not invalidate an access credential before
that credential's advertised expiry. One statement avoids combining authority
observed at different instants. An already authorized in-flight command may
finish after a later role change; the next request sees the new authority.

Cross-table deadlines, the successor relationship, and account-wide
revocation cannot be fully expressed as MySQL checks. The Unit of Work enforces
them, and real-MySQL tests prove commit, rollback, locking, and adversarial row
constraints.

## Credential and password representation

Access credentials have exact wire form
`oms_at_v1_<43-base64url-characters>` and refresh credentials use
`oms_rt_v1_<43-base64url-characters>`. The payload is 32 bytes from the
operating-system CSPRNG, encoded as unpadded Base64url. Each serialized value
therefore has 256 random bits and 53 ASCII characters. Parsers reject every
other prefix, version, alphabet, padding, or length before a lookup.

SHA-256 of the complete ASCII wire value is stored as `BINARY(32)`. SHA-256 is
appropriate here because the input is a high-entropy machine secret; it is not
appropriate for passwords. Access and refresh credentials have separate
tables and accepted prefixes, preventing cross-use.

The transport bounds the submitted password to 256 Unicode code points and
1,024 UTF-8 bytes before normalization, rejecting invalid Unicode without
trying to repair it. The password boundary then applies NFC and rechecks the
same upper bounds on the complete normalized value. Initial establishment
requires the normalized value to contain at least 15 code points. All valid
Unicode scalar values and whitespace are allowed, no composition rule is
imposed, and values are never trimmed or silently truncated. A local,
versioned blocklist compares the complete normalized candidate and rejects
common, expected, or compromised passwords without sending a password or hash
prefix to an external service. Hashing and verification always consume that
same complete normalized byte sequence. Login follows the same bounded
normalization path but returns only the fixed authentication failure for an
in-bound non-matching value.

Argon2id stores a unique salt and parameters in the PHC value. Identity accepts
only canonical ASCII
`$argon2id$v=19$m=<memoryKiB>,t=<iterations>,p=<lanes>$<salt>$<tag>` with that
exact field order, minimally encoded unsigned decimals, standard unpadded
canonical Base64, no optional PHC fields, a 16-byte salt, and a 32-byte tag.
Memory is 19,456 through 131,072 KiB, iterations are 2 through 6, and lanes are
1 through 4. Values outside this compatibility and resource envelope are
rejected before invoking Argon2. The fixed column remains wider than the first
format so a future reviewed expansion can migrate safely.

The reviewed generation default is 65,536 KiB memory, three iterations, one
lane, a unique 16-byte CSPRNG salt, and a 32-byte output. Deployments benchmark
upward only inside the accepted envelope and the process memory budget. The
crypto adapter parses and enforces both the domain envelope and its configured
resource ceiling before calling the provider. A future preferred-cost increase
does not make an older in-envelope verifier unreadable: successful verification
may calculate an upgraded PHC outside the transaction and conditionally replace
it inside the login transaction. Supporting another Argon version, algorithm,
salt/tag size, or cost envelope requires an explicit compatibility decision;
the parser never silently accepts it.

An unknown, malformed, suspended, or deactivated login still performs one
verification against a current-cost dummy PHC value after Redis allows the
attempt. No claim of perfectly identical timing is made; fixed responses,
dummy work, rate limits, and bounded concurrency reduce enumeration signal.
The initial implementation has no pepper because there is no hardware-backed
key lifecycle in the zero-cost environment. Adding a process secret without a
rotation and recovery design would turn configuration loss into account loss.

A known authenticator increments its MySQL consecutive-failure count in a
short transaction after an admitted failed verification. Starting with failure
five, it sets `nextVerificationAt` to
`dbNow + min(2^(failureCount - 5) seconds, 15 minutes)`. The count saturates at
100. Failures 5 through 99 move the deadline by the formula above. The 100th
failure atomically sets `REBIND_REQUIRED`, records `disabledAt`, clears the
deadline, and appends the closed disable event. A request before an active
authenticator's deadline, or any request for a disabled authenticator, performs
current-cost dummy work and receives the same failure without changing durable
state. A successful real verification of an active authenticator at or after
the deadline resets count and deadline in the login transaction.

The public response exposes neither count, deadline, state, nor disable time.
One hundred is the current NIST maximum, not a desired operating threshold;
the Redis limits apply much earlier. Disabling only the password authenticator
keeps Account lifecycle and existing-session revocation separate from an
attacker-controlled event. A disabled authenticator returns only through the
offline rebind command defined above.

## Session lifetime and transactions

Validated defaults and initial bounds are:

| Setting | Default | Accepted range |
| --- | ---: | ---: |
| Access lifetime | 15 minutes | 5 through 30 minutes |
| Refresh idle lifetime | 1 hour | 15 minutes through 24 hours |
| Refresh absolute lifetime | 7 days | 1 through 30 days |
| Identity database transaction timeout | 5 seconds | 1 through 10 seconds |
| Redis abuse-decision timeout | 100 milliseconds | 25 through 500 milliseconds |

Idle lifetime cannot exceed absolute lifetime. An access expiry is capped by
the family absolute deadline, not the refresh idle deadline. Rotation moves
the idle deadline to the earlier of `dbNow + idle lifetime` and the absolute
deadline. Access-token use alone does not extend either refresh deadline. A
current refresh presented after idle expiry fails without issuing a successor;
an otherwise valid access credential may continue only until its own expiry or
family revocation/absolute expiry.

At login, family absolute expiry is `dbNow + absolute lifetime`; family idle
expiry and first-refresh expiry are both
`min(dbNow + idle lifetime, absolute expiry)`. At refresh, the successor expiry
and new family idle expiry are both
`min(dbNow + idle lifetime, absolute expiry)`. Every new access expiry is
`min(dbNow + access lifetime, absolute expiry)`. A refresh with less than one
whole second before absolute expiry is rejected as an invalid refresh rather
than issuing near-zero-lived credentials. All calculations use the one
transaction `dbNow` and retain microsecond database precision.

### Authoritative time

Identity never uses an API replica's wall clock for a credential, cooldown,
session, or retention decision. Every Identity write transaction selects one
`CURRENT_TIMESTAMP(6)` value from the MySQL writer after the transaction begins
and names it `dbNow`; every deadline comparison and derived timestamp in that
transaction uses that immutable value. The single-statement Bearer authority
query and each cleanup batch similarly select the database time once in a
one-row derived table and join against it. Issued responses calculate
`expiresInSeconds` only from persisted `issuedAt`/`expiresAt` values derived
from the same `dbNow`, never from response-serialization time. Domain tests use
an injected Clock value, but the production adapter supplies only this database
instant.

Identity reads and writes use the MySQL writer endpoint, never an asynchronous
read replica. The connection sets and verifies UTC session time. Deployment
requires synchronized database and API hosts; each process compares observed
database time with its synchronized wall clock and a monotonic high-water mark.
An absolute drift over two seconds, a database time more than two seconds
behind the process high-water mark, an unavailable writer-time query, or an
invalid time-zone session makes a time-dependent HTTP decision fail closed with
its expected `503` and makes an offline command refuse; both raise the dedicated
clock-health signal. The tolerance accommodates concurrent query completion
reordering but is not added to credential validity. The adapter never
substitutes local time or clamps a regressed value. Public credential issuance
is gated until the chosen MySQL provider's writer/failover clock behavior passes
this check. Redis server time remains a separate input used only for
non-authoritative abuse buckets.

When a transaction needs more than one Identity aggregate, the global lock
order is:

`bootstrap -> account -> password authenticator -> session families by UUID -> refresh credential`

Role assignment locks account then role. Role retirement never traverses
accounts in reverse order. A rejected-login update may lock only the separate
PasswordAuthenticator and never seeks Account afterward. Redis calls,
Argon2id work, logging, RabbitMQ, and all external calls occur outside MySQL
transactions.

### Login

1. Validate transport and browser request policy.
2. Atomically obtain the Redis abuse decision.
3. Read authentication material without a lock and perform real or dummy
   Argon2id verification outside a transaction. Unknown/inactive accounts,
   active authenticators still in cooldown, and `REBIND_REQUIRED`
   authenticators use only the dummy PHC.
4. Generate candidate raw access and refresh credentials outside a
   transaction.
5. Lock account then password authenticator; prove account state, versions,
   PHC, and verification deadline are unchanged since verification.
6. Load authenticating family identifiers, lock any limit victim in UUID
   order, revalidate the five-family cap, and revoke the deterministic oldest
   victim when required.
7. Atomically create the family, first refresh digest, access digest, any
   conditional PHC upgrade, reset durable failures, append the limit event if
   required, resolve the bounded current permission projection, and append the
   success security event.
8. Commit before returning the access value and setting the refresh cookie.

An admitted failed real verification performs a separate short conditional
update of the known active authenticator's durable failure state and appends
the bounded reject event; the transition at 100 also appends the disable event.
Dummy verification never mutates a disabled or cooling authenticator. An
unknown candidate has no durable account row; Redis still treats the candidate
identically. A race against password replacement, rebind, or account state
change retries only the bounded state decision and never reuses a verification
snapshot to issue credentials.

One successful login creates one family and normally preserves other devices.
Replacing a browser cookie can leave an older family valid until logout,
limit eviction, expiry, password replacement, or explicit future session
management. Five is a deliberate initial administrative-session limit, not a
claim that the abandoned browser family can be recovered.

### Refresh

1. Validate browser request policy and strict refresh-token shape.
2. Obtain the Redis decision before authoritative MySQL work.
3. Use a non-locking digest projection only to discover account, family, and
   credential IDs. It searches all retained digests and does not filter on
   consumption or credential expiry, because an old consumed row is still a
   replay detector.
4. Lock and revalidate account, family, then presented credential in the
   global order.
5. Evaluate consumption before the presented row's expiry. If it is consumed
   and the family is unrevoked and before absolute expiry, revoke the family
   and append `REFRESH_REUSE_DETECTED` even when that predecessor's own expiry
   or the family's refresh-idle deadline has passed. Commit revocation before
   returning the fixed failure.
6. For an unconsumed credential, require an active account, unrevoked family,
   future family absolute and idle deadlines, and future credential expiry.
   Mark it consumed, insert its successor and the
   new access digest, link the successor, extend the idle deadline, resolve the
   bounded current permission projection, and append one event in the same
   transaction. Projection failure rolls back rotation rather than committing
   a session response the server cannot construct.

Unknown, expired, inactive-account, and already-revoked cases issue no
credential. The server cannot know whether a consumed credential was replayed
by an attacker or concurrently by the legitimate browser, so it revokes both
possibilities. Browser and CLI clients must serialize refresh; the future web
client must use a cross-tab coordinator rather than independent timers.

### Logout and account changes

Logout uses a non-locking digest projection to locate identifiers, then locks
Account and family in the global order and idempotently records revocation plus
a security event. It does not update every access row; the authority join makes
family revocation immediately effective. An unknown or already-invalid cookie
still receives a successful idempotent logout after safe lookup.

Suspension, deactivation, and password replacement lock the account, then its
bounded active families in UUID order, and revoke them atomically. Permission
changes do not revoke sessions because principal resolution always reads the
current assignments.

## HTTP contract

All routes are absent until the delivery gate is met. They follow the API's
existing trailing-slash tolerance but accept no other path or method aliases.

| Operation ID | Method and path | Request | Success |
| --- | --- | --- | --- |
| `loginAdministrator` | `POST /api/v1/auth/login` | Strict `LoginRequest` JSON and CSRF header | `200` `IssuedSession`; sets refresh cookie |
| `refreshAdministratorSession` | `POST /api/v1/auth/refresh` | No body; refresh cookie and CSRF header | `200` `IssuedSession`; rotates refresh cookie |
| `logoutAdministratorSession` | `POST /api/v1/auth/logout` | No body; optional refresh cookie and CSRF header | `204`; clears refresh cookie |
| `getAdministratorSession` | `GET /api/v1/auth/session` | Bearer access credential only | `200` `SessionView` |

`LoginRequest` has exactly two members:

```json
{
  "login": "catalog.admin",
  "password": "a complete password value"
}
```

Both values must be JSON strings. Before normalization, login transport is
bounded to 128 UTF-8 bytes and password transport to 256 code points and 1,024
UTF-8 bytes; unknown members, missing members, malformed Unicode, and larger
values are fixed `400`. Password normalization then applies the post-NFC bound
defined above. Creation stores only login names matching
`[a-z0-9][a-z0-9._-]{2,63}`. Login accepts the equivalent ASCII case variants,
lowercases them, never trims them, and treats every other in-bound candidate
as a fixed authentication failure after dummy verification.

Login accepts only `application/json` with UTF-8 semantics and never redirects
a password-bearing POST. Refresh, logout, and current-session require a
zero-length body and no body content type; a body from 1 byte through the
global 100-KiB limit is fixed `400`, and a larger body is fixed `413`. Any
non-identity `Content-Encoding` on an Identity operation is fixed `415` before
DTO or credential work. Login's missing, unsupported, or non-UTF-8 JSON media
type is also fixed `415`; a bodyless operation with any `Content-Type` is fixed
`400`. A bounded body-presence guard enforces those rules even when the global
JSON parser would not select the request. Query parameters are not part of any
Identity route and are fixed `400`.

`IssuedSession` has exactly:

```json
{
  "accessToken": "oms_at_v1_<43-base64url-characters>",
  "tokenType": "Bearer",
  "expiresInSeconds": 900,
  "session": {
    "actorId": "018f58e4-7ab2-7a1f-8cf8-a63a47b42010",
    "sessionId": "018f58e4-7c21-7ce5-902a-330d78ec40ab",
    "permissions": ["catalog.products.read"],
    "accessTokenExpiresAt": "2026-08-23T12:15:00.000000Z",
    "refreshIdleExpiresAt": "2026-08-23T13:00:00.000000Z",
    "refreshAbsoluteExpiresAt": "2026-08-30T12:00:00.000000Z"
  }
}
```

`expiresInSeconds` is the floor of the positive whole seconds between the
issuance instant and `accessTokenExpiresAt`; it is at least one and is capped
only by the family absolute deadline. `SessionView` is the nested `session`
object. UUIDs are canonical lowercase UUIDv7, timestamps are canonical UTC with
six fractional digits, and permissions are distinct and lexicographically
sorted. Login name and role names are deliberately absent. Schemas reject
additional properties.

### Bearer parsing

Protected routes accept an access credential only through exactly one
`Authorization` field using the case-insensitive `Bearer` scheme and one
syntactically valid access value. Cookie, query, form, and request-body access
credentials are never accepted. Missing, repeated, comma-combined, malformed,
wrong-prefix, expired, revoked, or unknown values all produce the fixed `401`.

Login, refresh, and logout do not use an `Authorization` value. Any such field
on those operations is fixed transport `400`; it is never ignored or selected
over the operation's defined credential.
Command-line automation uses an access token for protected resources and a
protected cookie jar for refresh; a future service account will use a separate
contract.

### Refresh cookie

Successful login and refresh send exactly:

```text
Set-Cookie: __Host-oms-refresh=<refresh>; Path=/; Secure; HttpOnly; SameSite=Strict
```

There is no `Domain`, positive `Max-Age`, or `Expires`, so this is a
browser-session cookie. MySQL still enforces the idle and absolute deadlines;
browser session restore cannot extend them. Clearing uses the same name and
attributes with `Max-Age=0` and a fixed past `Expires`; inconsistent path or
security attributes are prohibited.

The adapter combines one or more raw `Cookie` fields in received order with the
standard `; ` delimiter before parsing; split HTTP/2 or HTTP/3 fields are not a
failure by themselves. The combined value is bounded to 4,096 ASCII bytes and
32 cookie-pairs. Refresh reads only the target name. A duplicate target
cookie-pair, malformed combined syntax, bound violation, or invalid token shape
is authentication failure. Other well-formed cookies are ignored. Login
failure does not clear an existing session. Invalid refresh and completed
logout do clear it.

Logout never chooses among ambiguous credentials. An absent refresh cookie,
duplicate refresh-cookie names, malformed Cookie field, or invalid refresh
shape receives idempotent `204` and the clearing cookie without a database
lookup. A syntactically valid retained value locates its family even if that
credential is consumed or expired and revokes any still-unrevoked family; an
unknown or already-revoked family has no further state change. Every decided
case receives the same `204` and clear. If MySQL fails before logout can decide
and commit revocation for a syntactically valid value, logout returns `503` and
leaves the cookie intact so the client can retry; the frontend drops its
in-memory access credential immediately while revocation remains pending.
Selecting one value from a duplicate field would let an ambiguous request
revoke an unrelated family and is prohibited.

Every non-preflight Identity success and error sends
`Cache-Control: no-store`; token-issuing successes also send
`Pragma: no-cache`. They do not emit ETags. A `204` has no representation or
content type.

### Browser request policy

`POST /login`, `/refresh`, and `/logout` require exactly one
`X-OMS-CSRF: 1` header. A fixed value is intentional: its security property is
that browser JavaScript cannot set the non-simple header cross-origin without
a successful CORS preflight. It is not an authentication secret and is not
persisted.

The API applies these rules before credential work:

- credentialed CORS is disabled for the preferred same-origin deployment. If
  local development needs it, it reflects only an exact configured origin and
  sends `Vary: Origin`; wildcard origins and wildcard-with-credentials are
  invalid configuration;
- an `Origin` header, when present, must be the API origin or an exact allowed
  administrative-console origin; `null`, suffix, wildcard, and string-prefix
  matches are rejected;
- when Fetch Metadata is present, unsafe POSTs accept only
  `Sec-Fetch-Site: same-origin` or `same-site` together with an exact allowed
  Origin and only `Sec-Fetch-Mode: same-origin` or `cors`; `cross-site`,
  `none`, `navigate`, and `no-cors` are rejected. Missing Fetch Metadata
  remains valid for a non-browser CLI only because the custom header is still
  mandatory;
- preflight varies on `Origin`, `Access-Control-Request-Method`, and
  `Access-Control-Request-Headers`; it never authenticates, consumes an abuse
  bucket, or receives a credential; Fetch Metadata-dependent responses also
  vary on `Sec-Fetch-Site` and `Sec-Fetch-Mode`; and
- browser requests use `credentials: include`, while the access credential
  remains only in memory.

Showcase and production accept the Identity surface only over HTTPS and apply
HSTS at the reviewed ingress. Localhost is the only permitted insecure browser
development exception; no production request is upgraded by redirecting a
credential-bearing POST.

The deployed console and API must be same-origin. Local development may use
one exact same-site localhost console origin through credentialed CORS, or an
API proxy. In the showcase, serve or proxy the administrative console through
the API origin. A frontend on an unrelated free-provider domain is not a
reason to weaken the cookie to `SameSite=None`.

For the one configured local cross-origin console, a well-formed allowed
preflight receives `204` with no body and exactly:

```text
Access-Control-Allow-Origin: <the exact request Origin>
Access-Control-Allow-Credentials: true
Access-Control-Allow-Methods: GET, PATCH, POST
Access-Control-Allow-Headers: Authorization, Content-Type, Idempotency-Key, If-Match, X-Correlation-Id, X-OMS-CSRF
Access-Control-Max-Age: 600
Vary: Origin, Access-Control-Request-Method, Access-Control-Request-Headers
```

The requested method must be valid for the target route and every requested
header must be in that case-insensitive allow-list. A disallowed or malformed
preflight receives fixed `403`, no allow/expose/credentials headers, and the
same `Vary`. It never reaches authentication or Redis. Every non-preflight
Identity response includes `Vary: Origin, Sec-Fetch-Site, Sec-Fetch-Mode`
because those fields influence the request decision even though the response
is `no-store`. An allowed local cross-origin actual response additionally
includes exactly:

```text
Access-Control-Allow-Origin: <the exact request Origin>
Access-Control-Allow-Credentials: true
Access-Control-Expose-Headers: ETag, Location, Retry-After, WWW-Authenticate, X-Correlation-Id, X-Request-Id
Vary: Origin, Sec-Fetch-Site, Sec-Fetch-Mode
```

Aside from that `Vary`, same-origin responses need no CORS headers. Showcase
and production configure no cross-origin console and reject every foreign
Origin.

The ingress adapter begins with the canonical direct socket IP. When that peer
is outside every explicitly configured trusted-proxy CIDR, it ignores all
forwarding fields and uses the socket IP. When the peer is trusted, it requires
exactly one raw `X-Forwarded-For` field of at most 1,024 ASCII bytes containing
1 through 16 comma-separated IP literals. Empty elements, duplicate fields,
ports, zone identifiers, obfuscated/`unknown` values, or any invalid IP are
fixed transport `400`. The adapter appends the direct peer to that left-to-right
chain, walks from right to left across consecutive configured trusted proxies,
and selects the first untrusted address as the client. A missing field or an
all-trusted chain cannot establish a client and is `503`; no network abuse
decision occurs.

`Forwarded`, `X-Real-IP`, and every other forwarding field never influence the
client address. For production TLS terminated at a trusted peer, one
non-comma-combined `X-Forwarded-Proto: https` is also required; otherwise the
socket itself must be encrypted. Duplicate, malformed, or non-HTTPS forwarded
protocol is rejected before credential work. Localhost is the only direct-HTTP
exception. The API never enables an unrestricted framework `trust proxy` mode.
Public credential issuance remains gated until the chosen provider is proven
to overwrite or safely append these fields exactly as configured and its
actual proxy CIDRs/topology are verified. Raw addresses exist only transiently
for keyed abuse identifiers and are never logged or persisted.

### Failure contract
Identity uses the existing seven-member RFC 9457 representation. Stable
credential-exchange problem types are application-owned and must have
published HTTPS documentation before route registration; clients act on their
type rather than parsing detail text.

| Condition | Status and semantic headers | Cookie behavior |
| --- | --- | --- |
| Invalid JSON, non-cookie headers, query, DTO shape, prohibited content type on a bodyless route, or a prohibited body within the limit | Fixed `400` | Unchanged |
| Request content exceeds 100 KiB | Fixed `413` | Unchanged |
| Unsupported login media type/charset or any non-identity content encoding | Fixed `415` | Unchanged |
| Origin, Fetch Metadata, or CSRF rejection | Fixed `403` | Unchanged |
| Unknown login, wrong password, inactive account, authenticator cooldown/disable, or invalid refresh | Fixed credential-exchange `400`; no challenge | Login unchanged; invalid refresh cleared |
| Missing, malformed, expired, revoked, or unknown Bearer access credential on a protected resource | Fixed `401`; `WWW-Authenticate: Bearer realm="oms-api"` | Unchanged |
| Authenticated principal lacks permission | Fixed `403` | Unchanged |
| A Redis bucket denies issuance | Fixed `429`; `Retry-After` is the largest denying bucket's next whole second, bounded from 1 through 180 | Unchanged |
| Local Argon2id capacity is full | Fixed `429`; `Retry-After: 1` | Unchanged |
| Redis cannot decide login/refresh, or MySQL cannot supply trusted time or complete any required Identity read, durable failure/event update, family-limit eviction, issuance, rotation/reuse decision, logout revocation, or Bearer authority query | Fixed `503`; `Retry-After: 5` | Unchanged |
| Logout cookie is absent, malformed, duplicate, invalid, unknown, consumed, expired, or already revoked and no dependency decision remains | `204` | Cleared |
| Unexpected failure | Fixed `500` | Unchanged unless revocation already committed and the trusted logout mapper can prove it |

Each OpenAPI operation declares only this closed response set; it never
inherits the union of the table above:

| Operation | Declared responses | Exact failure applicability |
| --- | --- | --- |
| `loginAdministrator` | `200`, `400`, `403`, `413`, `415`, `429`, `500`, `503` | `400` is transport or fixed login rejection; `429` is Redis denial or local Argon2id saturation; `503` is an indeterminate Redis decision or any expected required MySQL inability. It never declares `401`. |
| `refreshAdministratorSession` | `200`, `400`, `403`, `413`, `415`, `429`, `500`, `503` | `400` is transport or fixed refresh rejection and only the latter clears the cookie; `429` is Redis denial; `503` is an indeterminate Redis decision or any expected required MySQL inability. It never declares `401`. |
| `logoutAdministratorSession` | `204`, `400`, `403`, `413`, `415`, `500`, `503` | Cookie absence or invalidity is the `204` clear path; `400` covers other malformed transport; `503` applies only when a syntactically valid credential requires a MySQL decision that cannot complete. It never calls Redis or declares `401`/`429`. |
| `getAdministratorSession` | `200`, `400`, `401`, `403`, `413`, `415`, `500`, `503` | `400`, `413`, and `415` cover its bodyless/query transport; `401` covers every Bearer rejection; `403` is only foreign-Origin policy, never missing permission; `503` covers an expected authority-query inability. It never declares `429`. |

The CORS middleware's preflight `204`/`403` behavior is exact but is not
published as a separate business operation. All listed errors use the existing
fixed `about:blank` descriptor unless one of the four typed Identity/
authorization problems below applies.

The credential-exchange `400` uses one fixed type for all syntactically
admissible login failures and another for all refresh failures. They have no
Bearer challenge. The Bearer `401` uses title `Authentication Required` and
detail `A valid Bearer credential is required.` Occurrence identifiers still
differ per request. The challenge omits OAuth error and description fields so
it does not distinguish missing, expired, revoked, or malformed access
credentials.

| Problem | Type | Title | Fixed detail |
| --- | --- | --- | --- |
| Login rejected | `https://its-me-jk.github.io/order-management-system/problems/authentication-failed` | Authentication Failed | The submitted credentials were not accepted. |
| Refresh rejected | `https://its-me-jk.github.io/order-management-system/problems/session-refresh-failed` | Session Refresh Failed | The session could not be refreshed. |
| Bearer rejected | `https://its-me-jk.github.io/order-management-system/problems/authentication-required` | Authentication Required | A valid Bearer credential is required. |
| Permission rejected | `https://its-me-jk.github.io/order-management-system/problems/permission-denied` | Permission Denied | The authenticated principal is not allowed to perform this operation. |

The first two types deliberately use `400`: login and refresh exchange
credentials but are not resources protected by an already-issued Bearer
credential. Applying a Bearer challenge there would tell a client to solve the
wrong protocol. The latter two types are shared with the Catalog
administration contract.

Only a sealed authentication mapper may emit that challenge. Only the sealed
Identity cookie writer may create or clear the refresh cookie. The generic
Problem Details writer continues to discard arbitrary exception headers and
must not start preserving `WWW-Authenticate` or `Set-Cookie` globally.

## Redis abuse control

The Identity application owns a `CredentialAbuseControl` port. A technical
Redis package owns connection lifecycle, TLS, authentication, timeouts, and
shutdown; the Identity Redis adapter owns the atomic algorithm and key schema.
One Lua/function operation refills and conditionally consumes every applicable
token bucket so concurrent replicas cannot overspend a limit.

The operation obtains `TIME` once from the authoritative Redis server; API
replica clocks are never inputs. Each bucket stores its last accepted server
microsecond and clamps a regressed post-failover time to that value. Refill and
consumption use checked integer fixed-point units with a carried remainder,
never Lua floating-point comparison, and update all applicable buckets from
the same instant. A forward clock jump may refill no more than capacity. Script
cache loss triggers one bounded `EVAL` reload-and-retry only for the explicit
`NOSCRIPT` response before any script ran; timeout, connection loss, failover,
or any result whose commit state is unknown is not retried in-request and is
`503`. Keys share one static Redis Cluster hash tag so the atomic operation
cannot silently become cross-slot if the runtime topology changes.

The initial adapter requires Redis 7 or a protocol-compatible managed service
with effect-replicated scripts, `TIME`, `SCRIPT LOAD`, `EVALSHA`, key expiry,
and hash-tag semantics enabled. Startup capability checks are read-only and
sanitized; an incompatible provider prevents Identity issuance readiness
rather than selecting a weaker client-side-clock algorithm.

Initial configurable defaults are:

| Route | Dimension | Capacity | Refill |
| --- | --- | ---: | ---: |
| Login | Deployment | 60 | 1 per second |
| Login | Trusted network | 30 | 1 per 10 seconds |
| Login | Canonical candidate | 5 | 1 per 3 minutes |
| Refresh | Deployment | 300 | 5 per second |
| Refresh | Trusted network | 120 | 1 per 2.5 seconds |
| Refresh | Presented credential | 3 | 1 per 100 seconds |

These are conservative operating starting points for the administrator-only
surface, not values prescribed by a standard. Load, credential-stuffing, NAT,
and false-positive tests must validate them before public issuance; changes
remain reviewed configuration within bounded limits.

All permitted login attempts consume every login dimension before account
lookup or Argon2id. Successful login may clear only the candidate bucket; it
does not erase network or deployment pressure. Refresh values are evaluated
before MySQL authority. The response exposes only the largest whole-second
wait as `Retry-After`, bounded from 1 through 180, never which dimension denied
it. No per-dimension rate-limit header is exposed.

Redis keys contain an algorithm version and base64url HMAC-SHA-256 of the
canonical candidate, normalized network, or presented wire credential using a
dedicated abuse-key secret containing at least 32 CSPRNG bytes. It is separate
from database and Redis credentials. Keys contain no raw login, IP, token,
actor, or session value. Key TTL is the bounded time to refill. Secret rotation
changes the namespace and temporarily resets throttle history, so it is an
explicit operational event rather than an ad hoc environment change.

Network normalization uses the canonical individual IPv4 address and the
canonical IPv6 `/64` prefix. This balances IPv6 privacy-address rotation
against over-broad blocking; carrier or enterprise NAT still creates a known
shared-bucket trade-off that load and false-positive tests must measure.

Apart from the explicit pre-execution `NOSCRIPT` recovery above, the client
performs no retry inside one HTTP request. Timeout, connection loss, script
version mismatch, partial/indeterminate result, or missing required network
identity is `503` with `Retry-After: 5` for login and refresh. A per-process
Argon2id semaphore caps simultaneous verification according to the configured
memory budget; the initial default is two with no unbounded wait queue.
Saturation is `429` with `Retry-After: 1`.

Redis remains absent from global API readiness because anonymous reads and
Bearer authority do not require it. Credential-issuance availability and
Redis decision latency receive separate metrics and alerts.

## Security events, privacy, and retention

Identity records closed events such as bootstrap, login accepted/rejected,
refresh rotation, refresh reuse, logout, family revocation, password
authenticator disabled/rebound, password replacement, role creation/rename/
retirement, role grant/revoke, suspension, resumption, and deactivation.
State-changing events commit with their state. A rejected login admitted by
Redis may record a bounded event with a nullable account identifier; it never
records the candidate value.

Security records contain no arbitrary metadata JSON, login name, password,
PHC value, token, digest, cookie, IP, user agent, DTO, or exception text.
Diagnostic logs use static event names and opaque identifiers only. Identity
owns the write model; a future Audit query boundary consumes an exported
application contract rather than reading Identity tables.

Consumed refresh rows remain through family absolute expiry plus a 24-hour
incident and clock-skew buffer so reuse detection cannot be deleted early.
Access rows remain through expiry plus 24 hours. Children and families are
purged only in bounded worker batches after they cannot authenticate.
Cleanup traverses `(absolute_expires_at, id)` or `(expires_at, id)` keysets,
deletes access children first, refresh rows in ascending family sequence
(predecessor before the successor it references), and the family last. It
never disables `RESTRICT`, scans by offset, or deletes a refresh predecessor
while its family could still authenticate.
Security-event and account-erasure retention require a separately approved
policy; no arbitrary duration is implied here. Deactivated-account erasure may
remove login and password data while retaining the opaque UUID tombstone used
by immutable business audits.

The current shared database role makes append-only records logically, not
cryptographically, immutable. Separate writer/purger grants and an external
tamper-evident sink are future hardening; application code still exposes no
update or delete port for a security event.

## Configuration contract

Configuration is parsed once by `@oms/configuration`, returned as a frozen
typed object, and injected through composition. Feature code never reads
`process.env`. Startup reports invalid variable names only, never values.

Validated configuration covers the canonical public API origin, lifetimes,
Argon2id cost and concurrency, Redis TLS/auth/timeout, abuse
capacities/refills, exact development origins, trusted proxy CIDRs, and
dependency timeouts. Origin checks never derive authority from an untrusted
`Host` or forwarding header. Showcase and production require the explicit same
origin, trusted ingress, TLS dependency URLs, and secrets.
Cookie name, `Secure`, `HttpOnly`, `SameSite=Strict`, `Path=/`, token entropy,
digest algorithm, credential prefixes, MySQL-writer time source, UTC session,
and two-second clock-health tolerance are policy and are not deployment knobs.

The API does not become ready merely because insecure defaults were supplied.
Unsafe wildcard CORS, missing abuse HMAC secret, an idle deadline beyond the
absolute deadline, Argon2id below the floor, unbounded proxy trust, or
plaintext public dependency transport fails startup with sanitized output.

## OpenAPI and verification contract

OpenAPI adds one HTTP Bearer scheme for protected endpoints and one cookie
scheme documenting the refresh transport. Cookie security is described in
operation text because OpenAPI 3.0 cannot express every Set-Cookie attribute.
Protected business operations document conjunctive authority through the
distinct sorted `x-oms-required-permissions` extension; they do not present
local permission codes as OAuth scopes.
Local Swagger UI remains read-only, performs no auth persistence, and cannot
become a place to save tokens.

The implementation increment is incomplete until tests prove:

- Account, Role, SessionFamily, password, token, transition, and typed-outcome
  behavior with fake application ports;
- exact token entropy/encoding/digests, Argon2id verification and upgrade, and
  no secret-bearing error or diagnostic output;
- real-MySQL schema, collation, checks, indexes, bootstrap race, authority
  and exact bootstrap grants, attempt-100 disable and rebind races, concurrent
  five-family enforcement,
  account-wide revocation, zero-role authenticated projection, role/permission
  bounds, issuance projection rollback, joins, rotation, expired-predecessor
  replay-family revocation, concurrent refresh, writer-time consistency,
  replica-clock independence, drift/regression failure, lock order, rollback,
  expiry, and cleanup order/eligibility;
- real-Redis atomic concurrency, server-time refill/TTL, clock regression,
  fixed-point boundaries, `NOSCRIPT`, failover ambiguity, pseudonymous keys,
  denial, timeout, outage, and fail-closed behavior;
- split and bounded Cookie fields, duplicate target cookies, and duplicate or
  malformed Authorization/CSRF/forwarding headers; exact CORS preflight,
  Origin and Fetch Metadata rejection, cookie attributes, every per-route
  `400`/`401`/`403`/`413`/`415`/`429`/`500`/`503` declaration, and logout
  semantics over HTTP;
- Redis loss blocks login and refresh while anonymous Catalog, logout after an
  authoritative decision, MySQL readiness, and valid Bearer resolution retain
  their documented dependencies;
- suspension, password replacement, permission change, expiry, logout, and
  replay affect the next request; and
- the deterministic OpenAPI and a production NestJS-to-MySQL-and-Redis suite
  match the contract without enabling a route early.

## Incremental delivery sequence

1. Accept this contract and ADR-0017 without runtime code.
2. Scaffold `@oms/identity`; deliver Account values and lifecycle first, then
   PasswordAuthenticator, Role, SessionFamily, application ports, outcomes,
   and tests in bounded commits; expose no route.
3. Add the Identity Prisma fragment, forward migration, Unit of Work,
   repositories, authority read model, bounded cleanup use case, and
   real-MySQL tests.
4. Add cryptographic adapters and the concurrency-safe offline first-admin and
   disabled-authenticator rebind commands; prove their TTY/file-descriptor,
   redaction, operator-boundary, atomic revocation, and race contracts; create
   no default or showcase credential.
5. Add the technical Redis runtime, Identity abuse adapter, Compose/CI Redis,
   and real-Redis tests.
6. Compose the bounded Identity cleanup worker, metrics, and retention failure
   tests without exposing authentication routes.
7. Add trusted ingress, exact CORS/CSRF/cookie transport, typed exchange
   `400`, sealed Bearer `401` and cookie writers, and security regression tests
   while routes remain absent.
8. Compose all four routes, OpenAPI, and end-to-end tests in one release.
9. Only then implement Catalog administrative application commands behind the
   authoritative principal.

This order keeps each commit usable and reviewed while ensuring no partial
authentication surface becomes public.

## Why this design

- Split credentials reduce the persistence of XSS theft without making every
  administrative command depend on an ambient cookie.
- MySQL authority gives immediate security changes and avoids premature JWT
  signing-key and claim-version operations in one deployable API.
- Strict rotation detects replay while keeping raw refresh values
  unrecoverable from the database.
- An application-owned Unit of Work keeps security policy out of generic
  repositories and makes atomic event/state invariants testable.
- Redis contains attack cost across replicas without becoming session state or
  global readiness.
- Same-origin deployment turns a security property into an explicit topology
  requirement instead of weakening cookies for whichever free hosts happen to
  be available.

## Alternatives and trade-offs

- A managed identity provider or federated OIDC would reduce password and MFA
  ownership, but introduces provider lifecycle, callbacks, recovery, account
  linking, and free-tier dependency before the initial modular boundary is
  understood. It remains attractive before real production administration.
- A Backend for Frontend with only an HttpOnly session cookie reduces browser
  token handling, but makes all authenticated mutations part of the CSRF
  boundary and adds a proxy/session layer. Revisit with the actual frontend.
- Signed JWTs remove the per-request authority query but make revocation and
  permission changes stale unless another version/cache check is added.
- Returning refresh credentials in JSON makes CLI use easier but exposes the
  long-lived secret to browser JavaScript and accidental client persistence.
- A refresh replay grace period improves concurrency UX but weakens theft
  detection or requires recoverable successor storage.
- Fail-closed Redis protects credential issuance but deliberately reduces auth
  availability during a cache outage. Existing sessions and public reads keep
  a narrower failure domain.
- Disabling the password authenticator at 100 consecutive failures satisfies
  the hard guessing ceiling but lets a sufficiently persistent known-login
  attacker force an offline operator rebind. Lower distributed limits, alerts,
  control-plane audit, and keeping existing sessions alive constrain that
  unavoidable trade-off until phishing-resistant authenticators exist.
- Strict same-site cookies constrain zero-cost hosting. The remedy is a proxy
  or co-hosted console, not weaker credential transport.
- Password-only bootstrap is implementable and testable, but it is not
  phishing-resistant. The public showcase publishes no administrator
  credential, and real privileged production use requires MFA or federation.

## Interview questions

1. **Why hash opaque tokens with SHA-256 but passwords with Argon2id?** Opaque
   tokens already have 256 random bits, so a fast digest safely supports exact
   lookup. Human passwords have low, biased entropy and need an expensive,
   memory-hard verifier.
2. **Why keep access tokens out of cookies?** An in-memory Bearer token is not
   attached automatically to cross-site requests, so ordinary business
   mutations do not all become cookie-CSRF targets.
3. **Why does refresh replay revoke the family?** Rotation proves only that an
   old credential was used twice; the server cannot distinguish attacker from
   legitimate concurrency, so continuing either side is unsafe.
4. **Why not authorize from roles inside the access token?** Current MySQL
   permissions let suspension and grants take effect on the next request and
   keep business modules independent of Identity role names.
5. **Why does Redis fail closed only for login and refresh?** It protects the
   expensive, security-sensitive act of issuing credentials. It is not the
   authority for existing sessions or anonymous business reads.
6. **Why is a custom CSRF header useful if its value is public?** A cross-site
   form cannot set it, and cross-origin JavaScript needs a successful CORS
   preflight. Its unforgeability comes from the browser boundary, not secrecy.
7. **Why avoid an account lock after five failures but disable the password at
   100?** Early refillable limits and cooldown make bulk guessing expensive
   without changing Account lifecycle. The separate authenticator still has to
   honor NIST's hard ceiling; reaching it requires an audited offline rebind but
   neither suspends the Account nor revokes attacker-unrelated sessions.
8. **Why perform Argon2id outside the transaction?** It is deliberately slow;
   holding a database connection and locks during hashing amplifies contention.
   The transaction revalidates the snapshot before issuing credentials.
9. **Why require same-site hosting?** `SameSite=Strict` is a meaningful browser
   control and avoids relying on increasingly restricted third-party cookies.
   Deployment convenience is not a reason to expand credential exposure.
10. **Why is logout `503` when MySQL is down?** Returning success would claim
    server-side revocation that did not occur. The client can discard its
    in-memory access value and retry while retaining the refresh cookie.
11. **Why version permission mappings with the Role instead of treating the
    join table as unrelated CRUD?** A mapping changes effective authority. One
    aggregate version and one transaction make concurrent grants, revokes, and
    retirement observable, reject lost updates, and produce precise security
    evidence.
12. **Why is refresh idle expiry not a SessionFamily status?** It stops refresh
    issuance only. A previously issued access credential may remain valid
    until its own or the family absolute deadline, so persisting `EXPIRED`
    would conflate two different authorization decisions.
13. **Why not carry the family version found during refresh-token lookup?** The
    lookup is deliberately non-locking. A concurrent winner may consume that
    credential; the loser must reload locked current state and treat the
    consumed row as replay instead of stopping at a stale-version mismatch.
14. **Why does SessionFamily rehydration relate version to rotation time?** A
    version does more than order writes: after subtracting creation and an
    optional terminal revocation, it counts rotations. Since no predecessor can
    refresh at or beyond its at-most-24-hour idle deadline, that count places a
    strict upper bound on the retained last-rotation time and detects impossible
    persistence state without loading token history.

## Future improvements

- Add WebAuthn/passkeys or federated OIDC, recovery codes, authenticator
  lifecycle, and step-up policy before real privileged production use.
- Add an administrator session list and revoke-one/revoke-all commands without
  exposing raw credential metadata.
- Add policy-aware approval workflows and temporary grants if operational use
  demonstrates a need; do not add wildcard permissions or make role display
  names authorization inputs.
- Evaluate a same-origin Backend for Frontend after the Next.js threat model is
  concrete.
- Add breached-password blocklist update provenance and offline freshness
  monitoring.
- Add password-change, recovery, and invitation contracts with mandatory
  reauthentication.
- Add separate database writer and retention roles plus a tamper-evident audit
  export.
- Revisit signed, audience-bound access credentials or an Identity network
  service only when an extracted service needs independent validation.
- Add risk signals only after privacy, false-positive, retention, and trusted
  network-source policies are reviewed.

## References

- [RFC 6750: Bearer Token Usage](https://www.rfc-editor.org/rfc/rfc6750.html)
- [RFC 6749: OAuth 2.0 token error semantics](https://www.rfc-editor.org/rfc/rfc6749.html#section-5.2)
- [RFC 9700: OAuth 2.0 Security Best Current Practice](https://www.rfc-editor.org/rfc/rfc9700.html)
- [RFC 10017: OAuth 2.0 for Browser-Based Applications](https://www.rfc-editor.org/rfc/rfc10017.html)
- [NIST SP 800-63B-4](https://pages.nist.gov/800-63-4/sp800-63b.html)
- [OWASP Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)
- [OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)
- [OWASP Session Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)
- [OWASP CSRF Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html)
- [Fetch Metadata Request Headers](https://www.w3.org/TR/fetch-metadata/)
- [Cookies: HTTP State Management Mechanism draft](https://datatracker.ietf.org/doc/draft-ietf-httpbis-rfc6265bis/)
