# ADR-0015: Authenticate and authorize administrative APIs

- **Status:** Accepted
- **Date:** 2026-08-22
- **Partially supersedes:** the deferral of authenticated `401` handling in
  [ADR-0010](0010-standardize-http-errors-with-rfc-9457.md), once the delivery
  gates in this record are implemented

## Context

Catalog administration is the first planned privileged HTTP surface. The API
currently has no Identity module, accepts no authentication credential, and
deliberately maps unsupported `401` behavior to a safe `500` because no owner
can yet produce a correct Bearer challenge. Exposing writes behind a shared
API key or an `isAdmin` flag would provide weak attribution, coarse authority,
and no safe session lifecycle.

The modular monolith needs one trust boundary that can later protect Orders,
Inventory, Payments, and operational administration without putting password,
token, or role logic in each business module. The public showcase must remain
usable without publishing administrator credentials.

## Decision

Identity and Access owns administrator credentials, accounts, sessions, role
bundles, permissions, authentication events, and token lifecycle. Business
modules receive a small authenticated-principal contract containing opaque
actor and session identifiers plus evaluated permissions. They never receive a
password, credential hash, raw token, email address, or Identity persistence
record.

Administrative APIs use an HTTP Bearer access credential. The initial access
credential is an opaque, cryptographically random value; only its digest is
stored in MySQL. Every privileged request resolves the authoritative session,
account state, and current permission set before application authorization.
The initial implementation performs one bounded MySQL lookup rather than
caching authority in Redis, so account suspension, session revocation, and
permission changes cannot be hidden by a stale authorization cache.

Access credentials are short-lived. Refresh credentials are independently
random, stored only as digests, rotated on every use, grouped into a session
family, and revoked together when reuse is detected. Exact lifetimes and
cryptographic cost parameters are validated configuration with safe minimum
and maximum bounds rather than source constants. The initial reviewed defaults
are a 15-minute access lifetime and a seven-day absolute refresh-session
lifetime.

The initial credential-issuance flow uses a canonical administrator login name
and password. Login names are lowercase ASCII values of 3 through 64
characters matching `[a-z0-9][a-z0-9._-]{2,63}`. Identity hashes passwords
with Argon2id using a unique salt and parameters no weaker than current OWASP
guidance. Passwords are never encrypted for recovery, logged, placed in events,
or stored outside the Identity credential boundary. Parameters are stored with
the hash so successful authentication can upgrade an older cost safely.

This record deliberately does not register login, refresh, or logout routes.
A separate Identity HTTP contract must first select their exact DTOs, refresh
credential transport, cookie attributes if cookies are used, CORS and CSRF
policy, revocation behavior, fixed failures, rate-limit dimensions, and
OpenAPI. Until that contract and its integration tests are accepted, no
credential-issuance route may be exposed.

There is no public registration in the initial administrative surface. The
first administrator is provisioned through an explicit offline command that
refuses to create default credentials, refuses to overwrite an existing
principal, and records the provisioning action. Test fixtures use isolated
databases and cannot become deployment credentials. The public showcase does
not advertise or distribute an administrator login.

Authorization uses permissions, not role names. Initial administrative
permissions
are:

- `catalog.products.read`
- `catalog.products.write`
- `catalog.products.publish`
- `catalog.skus.read`
- `catalog.skus.write`
- `catalog.skus.publish`
- `audit.records.read`

Identity may bundle those permissions into roles such as Catalog Viewer,
Editor, Publisher, Auditor, or Administrator. `audit.records.read` is reserved
for the separately contracted Audit query boundary and is never implied by a
Catalog permission. Catalog checks only the permission
set declared by the application command. Requirements are conjunctive: a
mutation returning a full administrative Product or SKU representation also
requires the corresponding read permission, and creating an SKU requires
Product read authority in addition to SKU read and write authority. Role
composition can therefore change without a Catalog release while commands
cannot accidentally disclose a read-protected representation. Authentication
and coarse transport rejection happen before resource lookup; the application
use case remains the authoritative authorization boundary for the command.

Missing, malformed, expired, revoked, or otherwise invalid credentials produce
the same fixed `401` Problem Details response and one validated
`WWW-Authenticate: Bearer realm="oms-api"` challenge. An authenticated
principal lacking any required permission receives a fixed `403`. Neither
response discloses whether an account, session, permission, or target resource
exists. Authentication and authorization complete before idempotency replay
lookup.

Login and refresh endpoints require distributed abuse controls before public
deployment. Their Redis policy is route-specific and fail-closed: when the
security control cannot make a safe decision, credential issuance returns a
sanitized unavailable response while anonymous Catalog reads remain healthy.
The API never accepts credentials in query strings, URLs, or logs.

Identity-owned login identifiers are personal data. They are excluded from
business events, request context, audit change payloads, and diagnostic logs.
Catalog audit records contain only opaque actor and session identifiers.
Retention and deletion operate on Identity records without rewriting immutable
business audit history; audit records retain the pseudonymous actor identifier
required for accountability under the accepted audit-retention policy.

## Consequences

### Positive

- Privileged actions have a real actor, revocable session, and least-privilege
  permission instead of a shared secret.
- Permission changes and account suspension take effect on the next
  authoritative session resolution rather than waiting for a long-lived token
  to expire.
- Opaque credentials avoid premature JWT key distribution and claim-versioning
  policy in a single-runtime modular monolith.
- Catalog remains independent of password, session, and role persistence.
- The public demo can expose anonymous reads without exposing administrative
  credentials.

### Negative

- Every administrative request requires a bounded authoritative MySQL session
  and permission lookup.
- Refresh rotation, reuse detection, provisioning, revocation, and security
  audit add substantial Identity behavior before the first write endpoint.
- Opaque access credentials cannot be validated independently by a future
  extracted service.
- Route-specific fail-closed rate limiting can make login unavailable during a
  Redis outage even while the rest of the API is ready.

## Alternatives considered

- **Shared administrative API key:** easy to bootstrap, but has no individual
  attribution, fine-grained permission, safe browser lifecycle, or practical
  least-privilege rotation.
- **Boolean administrator claim:** simple but couples every module to one
  permanently overpowered role.
- **Long-lived JWT access tokens:** reduce database lookups but delay revocation
  and permission changes and introduce signing-key rotation before a measured
  distributed validation need.
- **Managed identity provider immediately:** can reduce credential risk but
  adds a provider dependency, callback topology, and free-tier operational
  constraint before the showcase deployment is selected.
- **Public registration:** useful for customer identity later, but unnecessary
  and risky for an administrator-only first surface.

## Revisit when

Revisit opaque access credentials when an independently deployed service must
validate end-user authority without an Identity network call, or when measured
session lookup volume justifies a coherently invalidated Redis authorization
cache or signed access tokens. A replacement must retain short lifetimes,
audience restriction, rotation, revocation, least privilege, and
non-disclosure. Revisit administrator provisioning when an approved invitation
and recovery workflow exists.

## References

- [OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)
- [RFC 9700: Best Current Practice for OAuth 2.0 Security](https://www.rfc-editor.org/rfc/rfc9700.html)
