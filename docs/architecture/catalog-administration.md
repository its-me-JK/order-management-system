# Catalog administration

## Scope and delivery gate

This contract defines authenticated Product and SKU administration in the
modular monolith. It covers aggregate boundaries, commands, permissions,
idempotency, optimistic concurrency, audit, outbox participation, HTTP
representations, and safe failures.

It does not define Product attributes, media, taxonomy, search, bulk import,
scheduled publication, price, inventory, orderability, customer identity,
RabbitMQ topology, or a Catalog user interface. Those capabilities require
separate contracts.

No administrative route may be registered until the following capabilities
are implemented and integration-tested:

- authoritative Identity session resolution and explicit permission checks;
- the accepted [Identity and session contract](identity-and-session.md) for
  login, refresh, logout, credential transport, CSRF/CORS, and abuse controls;
- fixed Bearer `401` and authorization `403` behavior;
- published zero-cost HTTPS documentation for every application-specific
  Problem Details type and exact OpenAPI mappings for those failures;
- durable MySQL idempotency and strong precondition handling;
- immutable, transactionally written audit records;
- the explicit Unit of Work required to atomically coordinate Catalog, audit,
  idempotency, and outbox adapters;
- route-specific abuse controls for credential issuance.

A shared API key, development bypass, default administrator, caller-provided
actor header, or environment switch cannot substitute for these gates.

The lifecycle decision is owned by
[ADR-0014](../adr/0014-support-staged-and-reversible-catalog-publication.md),
authentication by
[ADR-0015](../adr/0015-authenticate-and-authorize-administrative-apis.md), and
retry and concurrency semantics by
[ADR-0016](../adr/0016-make-retryable-commands-durably-idempotent.md).

## Aggregate and command model

Product and SKU are separate aggregate roots. Product never loads its SKU
collection for an ordinary command. SKU owns its immutable Product reference
and code. Effective public visibility requires both roots to be `ACTIVE`.

The application exposes explicit commands rather than a generic persistence or
status API:

| Aggregate | Command | Allowed source state | Result |
| --- | --- | --- | --- |
| Product | Create | none | New `DRAFT` Product at version 1 |
| Product | Rename | `DRAFT`, `ACTIVE`, `SUSPENDED` | Name changed or validated no-op |
| Product | Activate | `DRAFT` | `ACTIVE` |
| Product | Suspend | `ACTIVE` | `SUSPENDED` |
| Product | Resume | `SUSPENDED` | `ACTIVE` |
| Product | Archive | `DRAFT`, `ACTIVE`, `SUSPENDED` | Terminal `ARCHIVED` |
| SKU | Create | none; Product must not be terminal | New `DRAFT` SKU at version 1 |
| SKU | Rename | `DRAFT`, `ACTIVE`, `SUSPENDED` | Name changed or validated no-op |
| SKU | Activate | `DRAFT` | `ACTIVE` |
| SKU | Suspend | `ACTIVE` | `SUSPENDED` |
| SKU | Resume | `SUSPENDED` | `ACTIVE` |
| SKU | Retire | `DRAFT`, `ACTIVE`, `SUSPENDED` | Terminal `RETIRED` |

SKU create, activate, and resume lock and validate Product before SKU using the
global Product-then-SKU order. A Product may be Draft or Suspended while an SKU
is individually Active. Product suspension or archival immediately removes
effective visibility without cascading through its SKUs.

SKU mutation routes contain only `skuId`. Inside the transaction, activate and
resume first use a non-locking, identifier-only projection to discover the
SKU's immutable `productId`. They then lock Product, lock and reload SKU,
verify its Product identifier is unchanged, and perform policy. The projection
does not authorize a state decision; its only purpose is to acquire locks in
the global order. SKU create already receives `productId` from its route.

There are no commands to hard-delete a Product or SKU, restore a terminal
aggregate, change an SKU code, move an SKU between Products, set an arbitrary
status, or apply an unbounded bulk transition.

## Value and lifecycle invariants

- Identifiers are application-generated canonical lowercase UUIDv7 values.
- Product and SKU names contain 1 through 160 Unicode code points, are already
  NFC-normalized, contain no Unicode control character, and have no leading or
  trailing Unicode whitespace. Input is rejected rather than silently trimmed
  or normalized.
- SKU code remains an immutable, globally unique, case-sensitive value of 3
  through 64 characters matching `[A-Z0-9][A-Z0-9._-]{2,63}`.
- Aggregate version starts at 1 and increments exactly once per actual
  mutation.
- Identifiers, creation time, SKU Product ownership, SKU code, and first
  activation time are immutable.
- Terminal aggregates are immutable.
- A same-value rename validates the expected version and performs no aggregate,
  audit, or outbox write and no version increment. Its completed idempotency
  result is still persisted for safe replay.
- Suspend, archive, and retire commands require one value from the closed audit
  reason-code set: `CONTENT_ERROR`, `COMPLIANCE_HOLD`, `SAFETY_RECALL`,
  `DISCONTINUED`, `DUPLICATE_RECORD`, or `MERCHANDISING_DECISION`. The initial
  contract accepts no free-form note. Reason codes are not part of the public
  Catalog projection or integration events.
- Application-owned timestamps use canonical UTC with exactly six fractional
  digits. The database receives those values rather than generating implicit
  lifecycle timestamps.
- `statusChangedAt` is non-null and equals `createdAt` when Draft is
  established. Only a real lifecycle transition changes it; rename and
  same-value commands leave it untouched.
- Administrative persistence and reads preserve all six timestamp digits with
  lossless string projections and reviewed parameterized SQL where Prisma's
  JavaScript `Date` mapping would truncate microseconds.

Database constraints remain the final row-shape guard, while the domain owns
legal transitions. The migration must add `SUSPENDED`, permit direct Product
Draft archival, add `status_changed_at`, and update lifecycle/timestamp checks.
It first adds that column as nullable, backfills Product Draft from
`created_at`, Active from `activated_at`, and Archived from `archived_at`, and
backfills SKU Draft from `created_at`, Active from `activated_at`, and Retired
from `retired_at`. It then makes the column non-null and installs the revised
checks. Before installing them, it raises, but never decreases, a legacy
version to the least reachable value implied by the existing lifecycle and
timestamps: Draft with a later update is at least 2, first Active is at least
2, Active with a later update is at least 3, direct terminal is at least 2, and
previously activated terminal is at least 3. It rejects incompatible chronology
or a terminal row whose update time differs from its terminal time rather than
rewriting business timestamps to invent history. Product terminal timestamp
ordering compares archival against `COALESCE(activated_at, created_at)`. The
migration is forward-only and must not edit the already applied migration or
weaken UUID, code, name, version, or referential constraints.

### Lifecycle migration rollout and recovery

The initial lifecycle expansion is deliberately a single forward migration
only while Catalog has no administrative writer and each table contains at
most 10,000 rows. A static preflight enforces the prior schema, the bounded row
count, supported legacy states, and recoverable chronology before the first
persistent DDL. The migration then adds nullable columns with
`ALGORITHM=INSTANT`, performs the deterministic backfill in one DML
transaction, validates the result, and contracts each table with the explicit
`ALGORITHM=COPY, LOCK=SHARED` required by the pinned MySQL release. Session
metadata- and row-lock waits are bounded at 15 seconds. The migration job runs
before application rollout, while Catalog writes remain disabled.

The table-copy contract step can permit reads but blocks writes and may take a
metadata lock. MySQL makes each DDL statement atomic, not the complete
multi-table migration. A failure can therefore leave an additive nullable
column, a completed version-floor backfill, or one contracted table. Operators
must keep writers disabled, inspect `information_schema`, migration state, row
counts, null counts, and the fixed postconditions, and prepare a reviewed
roll-forward reconciliation for the remaining phase. They must not drop a
populated, backfilled, or contracted new column, lower normalized versions,
rewrite business timestamps, or mark a failed Prisma migration applied without
proving the final schema and data contract. The only drop exception is the
runbook's rehearsed, all-null nullable expansion state. A tested backup is
required before running this migration against material data. The exact phase
decision table, permitted ledger resolutions, and lossless partial-expansion
rollback are maintained in the
[Catalog lifecycle migration recovery runbook](../runbooks/catalog-lifecycle-migration-recovery.md).

If either row-count guard fails or measured lock duration is no longer small,
the threshold is not raised to force deployment. The change is split across
releases into additive expansion, dual-compatible code, an idempotent bounded
primary-key-keyset backfill with progress telemetry, validation, and final
contraction. This preserves the repository-wide migration policy while
avoiding unnecessary machinery for the current bounded, writer-free state.

## Authentication and authorization

Administrative operations accept only the trusted principal produced by
Identity. Catalog receives:

- opaque actor identifier;
- opaque session identifier;
- evaluated permission set;
- server-owned request and validated correlation identifiers as command
  metadata.

It never receives or persists raw credentials, credential digests, login
identifiers, roles, or Identity records.

Permission requirements are conjunctive; every listed permission is required.

| Operation class | Required permissions |
| --- | --- |
| Product administration read | `catalog.products.read` |
| Product create or rename | `catalog.products.read`, `catalog.products.write` |
| Product lifecycle transition | `catalog.products.read`, `catalog.products.publish` |
| SKU administration read | `catalog.skus.read` |
| SKU create | `catalog.products.read`, `catalog.skus.read`, `catalog.skus.write` |
| SKU rename | `catalog.skus.read`, `catalog.skus.write` |
| SKU lifecycle transition | `catalog.skus.read`, `catalog.skus.publish` |

Roles are Identity-owned permission bundles and never appear in Catalog policy
or controller conditionals. Authentication and permission rejection occur
before resource lookup and before idempotency replay lookup. OpenAPI declares
an HTTP Bearer scheme and required permissions as operation documentation; it
does not mislabel local permissions as OAuth scopes.

## HTTP contract

Administrative routes use `/api/v1/admin/catalog`. They are absent, rather than
unsecured, until every delivery gate is complete.

| Operation ID | Method and path | Application command | Success | Required permissions |
| --- | --- | --- | ---: | --- |
| `catalogAdminGetProduct` | `GET /products/{productId}` | Query; no idempotency identity | `200` | `catalog.products.read` |
| `catalogAdminCreateProduct` | `POST /products` | `catalog.product.create.v1` | `201` | `catalog.products.read`, `catalog.products.write` |
| `catalogAdminRenameProduct` | `PATCH /products/{productId}` | `catalog.product.rename.v1` | `200` | `catalog.products.read`, `catalog.products.write` |
| `catalogAdminActivateProduct` | `POST /products/{productId}/activate` | `catalog.product.activate.v1` | `200` | `catalog.products.read`, `catalog.products.publish` |
| `catalogAdminSuspendProduct` | `POST /products/{productId}/suspend` | `catalog.product.suspend.v1` | `200` | `catalog.products.read`, `catalog.products.publish` |
| `catalogAdminResumeProduct` | `POST /products/{productId}/resume` | `catalog.product.resume.v1` | `200` | `catalog.products.read`, `catalog.products.publish` |
| `catalogAdminArchiveProduct` | `POST /products/{productId}/archive` | `catalog.product.archive.v1` | `200` | `catalog.products.read`, `catalog.products.publish` |
| `catalogAdminGetSku` | `GET /skus/{skuId}` | Query; no idempotency identity | `200` | `catalog.skus.read` |
| `catalogAdminCreateSku` | `POST /products/{productId}/skus` | `catalog.sku.create.v1` | `201` | `catalog.products.read`, `catalog.skus.read`, `catalog.skus.write` |
| `catalogAdminRenameSku` | `PATCH /skus/{skuId}` | `catalog.sku.rename.v1` | `200` | `catalog.skus.read`, `catalog.skus.write` |
| `catalogAdminActivateSku` | `POST /skus/{skuId}/activate` | `catalog.sku.activate.v1` | `200` | `catalog.skus.read`, `catalog.skus.publish` |
| `catalogAdminSuspendSku` | `POST /skus/{skuId}/suspend` | `catalog.sku.suspend.v1` | `200` | `catalog.skus.read`, `catalog.skus.publish` |
| `catalogAdminResumeSku` | `POST /skus/{skuId}/resume` | `catalog.sku.resume.v1` | `200` | `catalog.skus.read`, `catalog.skus.publish` |
| `catalogAdminRetireSku` | `POST /skus/{skuId}/retire` | `catalog.sku.retire.v1` | `200` | `catalog.skus.read`, `catalog.skus.publish` |

The table paths are relative to `/api/v1/admin/catalog`. Administrative list,
filter, and search operations are deliberately deferred until an admin client
defines their query and pagination needs.

Exact JSON request bodies are:

```json
{ "name": "Whole milk" }
```

for Product create or rename;

```json
{ "code": "MILK-1L", "name": "Whole milk 1L" }
```

for SKU create;

```json
{ "name": "Whole milk 1 litre" }
```

for SKU rename; and

```json
{ "reasonCode": "SAFETY_RECALL" }
```

for suspend, archive, or retire. Activate and resume accept no request body.
No operation accepts query parameters in the initial contract. Unknown fields,
wrong primitive types, and bodies on a bodyless action are rejected. Missing,
repeated, or malformed `Authorization` is `401`; missing, repeated, or malformed
`Idempotency-Key` is `400`; malformed or repeated `If-Match` is `400`; and an
otherwise valid operation that requires but omits `If-Match` is `428`.

All mutations require one `Idempotency-Key`. Rename and lifecycle operations
also require one exact strong `If-Match: "v<version>"`. Creates have no
precondition because the server generates the aggregate identifier.

Product success uses:

```json
{
  "data": {
    "id": "01890f3a-8bcd-7def-8abc-0123456789ab",
    "name": "Whole milk",
    "status": "ACTIVE",
    "version": 2,
    "createdAt": "2026-08-22T12:34:56.123000Z",
    "updatedAt": "2026-08-22T12:35:10.456000Z",
    "statusChangedAt": "2026-08-22T12:35:10.456000Z",
    "activatedAt": "2026-08-22T12:35:10.456000Z",
    "archivedAt": null
  }
}
```

SKU success has the same envelope and lifecycle metadata plus `productId`,
immutable `code`, and `retiredAt` instead of `archivedAt`.

Every member is required; nullable lifecycle timestamps are explicit `null`.
Responses never expose audit reasons, actor or session identity, idempotency
records, outbox state, persistence names, or ORM values.

Every success returns `Cache-Control: no-store`, request and correlation
headers, and `ETag: "v<version>"`. Create additionally returns a
server-constructed relative `Location` for the administrative detail resource.
Updates return `200` rather than `204` so the caller receives the committed
representation and validator. Replays preserve semantic status, body,
`Location`, and ETag while receiving fresh request identity headers.

## Failure contract

Errors use the exact seven-member RFC 9457 envelope defined by the
[HTTP error contract](http-error-contract.md). Generic transport or server
failures retain these existing `about:blank` descriptors:

| Key | Status | Title | Fixed detail |
| --- | ---: | --- | --- |
| `bad-request` | `400` | Bad Request | The request is invalid. |
| `forbidden` | `403` | Forbidden | You are not allowed to perform this operation. |
| `content-too-large` | `413` | Content Too Large | The request content exceeds the allowed size. |
| `unsupported-media-type` | `415` | Unsupported Media Type | The request media type is not supported. |
| `not-found` | `404` | Not Found | The requested resource was not found. |
| `internal-error` | `500` | Internal Server Error | The service could not complete the request. |
| `service-unavailable` | `503` | Service Unavailable | The service is temporarily unavailable. |

Machine-actionable administrative outcomes use this closed v1 registry. The
URLs must be published as durable HTTPS documentation through the repository's
zero-cost GitHub Pages origin before the routes are registered.

| Key | Status | Type URI | Title | Fixed detail |
| --- | ---: | --- | --- | --- |
| `authentication-required` | `401` | `https://its-me-jk.github.io/order-management-system/problems/authentication-required` | Authentication Required | A valid Bearer credential is required. |
| `permission-denied` | `403` | `https://its-me-jk.github.io/order-management-system/problems/permission-denied` | Permission Denied | The authenticated principal is not allowed to perform this operation. |
| `sku-code-conflict` | `409` | `https://its-me-jk.github.io/order-management-system/problems/sku-code-conflict` | SKU Code Conflict | The SKU code is already in use. |
| `catalog-lifecycle-conflict` | `409` | `https://its-me-jk.github.io/order-management-system/problems/catalog-lifecycle-conflict` | Catalog Lifecycle Conflict | The requested Catalog lifecycle transition is not allowed. |
| `idempotency-conflict` | `409` | `https://its-me-jk.github.io/order-management-system/problems/idempotency-conflict` | Idempotency Conflict | The idempotency key was already used for a different request. |
| `idempotency-in-progress` | `409` | `https://its-me-jk.github.io/order-management-system/problems/idempotency-in-progress` | Idempotency In Progress | A request using this idempotency key is still being processed. |
| `precondition-failed` | `412` | `https://its-me-jk.github.io/order-management-system/problems/precondition-failed` | Precondition Failed | The resource changed since the supplied precondition. |
| `precondition-required` | `428` | `https://its-me-jk.github.io/order-management-system/problems/precondition-required` | Precondition Required | This operation requires an If-Match header. |

The exact operation failure matrix is:

| Operation IDs | Possible descriptor keys |
| --- | --- |
| `catalogAdminGetProduct`, `catalogAdminGetSku` | `bad-request`, `forbidden`, `content-too-large`, `unsupported-media-type`, `authentication-required`, `permission-denied`, `not-found`, `internal-error`, `service-unavailable` |
| `catalogAdminCreateProduct` | `bad-request`, `forbidden`, `content-too-large`, `unsupported-media-type`, `authentication-required`, `permission-denied`, `idempotency-conflict`, `idempotency-in-progress`, `internal-error`, `service-unavailable` |
| `catalogAdminRenameProduct` | `bad-request`, `forbidden`, `content-too-large`, `unsupported-media-type`, `authentication-required`, `permission-denied`, `not-found`, `catalog-lifecycle-conflict`, `idempotency-conflict`, `idempotency-in-progress`, `precondition-failed`, `precondition-required`, `internal-error`, `service-unavailable` |
| `catalogAdminActivateProduct`, `catalogAdminSuspendProduct`, `catalogAdminResumeProduct`, `catalogAdminArchiveProduct` | `bad-request`, `forbidden`, `content-too-large`, `unsupported-media-type`, `authentication-required`, `permission-denied`, `not-found`, `catalog-lifecycle-conflict`, `idempotency-conflict`, `idempotency-in-progress`, `precondition-failed`, `precondition-required`, `internal-error`, `service-unavailable` |
| `catalogAdminCreateSku` | `bad-request`, `forbidden`, `content-too-large`, `unsupported-media-type`, `authentication-required`, `permission-denied`, `not-found`, `sku-code-conflict`, `catalog-lifecycle-conflict`, `idempotency-conflict`, `idempotency-in-progress`, `internal-error`, `service-unavailable` |
| `catalogAdminRenameSku` | `bad-request`, `forbidden`, `content-too-large`, `unsupported-media-type`, `authentication-required`, `permission-denied`, `not-found`, `catalog-lifecycle-conflict`, `idempotency-conflict`, `idempotency-in-progress`, `precondition-failed`, `precondition-required`, `internal-error`, `service-unavailable` |
| `catalogAdminActivateSku`, `catalogAdminSuspendSku`, `catalogAdminResumeSku`, `catalogAdminRetireSku` | `bad-request`, `forbidden`, `content-too-large`, `unsupported-media-type`, `authentication-required`, `permission-denied`, `not-found`, `catalog-lifecycle-conflict`, `idempotency-conflict`, `idempotency-in-progress`, `precondition-failed`, `precondition-required`, `internal-error`, `service-unavailable` |

The global exception mapper and OpenAPI components must add these descriptors
as one reviewed change. Only `authentication-required` may preserve the exact
`WWW-Authenticate: Bearer realm="oms-api"` header; no other descriptor may
carry an authentication challenge. Each operation documents only its row from
the matrix rather than the union of all failures. Catalog has no route-level
`429` contract in v1; rate limiting initially protects Identity login and
refresh only.

Generic `forbidden` is reserved for the shared Origin/Fetch Metadata boundary;
authorization uses only typed `permission-denied`. Because both are status
`403`, each administrative operation's single OpenAPI `403` response uses a
closed `oneOf` of those two exact Problem Details schemas. The bodyless GET
operations still declare `413` and `415`: the shared bounded body/encoding
guard runs before routing semantics and rejects hostile content consistently.

No response includes target identifiers, submitted values, current hidden
status or version, account or session existence, permission names, constraint
names, SQL, token failure reasons, exception messages, or causes. `401`, `403`,
and `404` order prevents a target lookup from becoming an authorization oracle.

## Transaction, audit, and events

One application service owns a short `READ COMMITTED` Unit of Work for a
successful command. Inside it, narrow transaction-aware ports:

1. establish or recognize the scoped idempotency record;
2. load the aggregate and any bounded parent check;
3. execute the domain operation;
4. conditionally persist the aggregate version;
5. append one immutable audit entry for an actual mutation;
6. append the single event mapped below for an actual mutation to the
   transactional outbox;
7. persist the replayable application result.

The operation commits completely or leaves none of those effects. No Redis,
RabbitMQ, logger, HTTP call, or external provider participates in the
transaction. The future worker publishes outbox messages with confirms and
idempotent consumer semantics from ADR-0004. Administrative writes are not
publicly deployable while required outbox publication or idempotency cleanup
work lacks an operational owner.

Audit entries contain only:

- audit event, actor, session, aggregate, and idempotency-record identifiers;
- stable action identifier and all required permission identifiers;
- previous and resulting aggregate versions;
- server-owned request and validated correlation identifiers;
- occurrence time and the required `reasonCode` for suspend, archive, or
  retire;
- allow-listed previous and resulting Catalog fields relevant to the action.

They never contain credentials, login identifiers, authorization headers, raw
request bodies, arbitrary metadata, exceptions, SQL, or diagnostic stack.
Idempotency replay writes a normal request completion log but does not append a
second business audit entry or outbox event.

Catalog audit rows are append-only for 365 days from occurrence. During that
window, reads require `audit.records.read`; no Audit read route exists until a
separate query, redaction, and pagination contract is accepted. A bounded
worker may purge only rows older than the retention cutoff that are not under
an explicit legal hold, and it records purge counts, duration, and failure
metrics. Applying or releasing a legal hold requires a separately authorized
and audited operational contract. This bounds retained copies of old and new
Catalog names while preserving accountability; administrators must not place
personal or secret data in Catalog names.

Every actual domain mutation creates an internal domain event and exactly one
of these initial integration events:

| Application command | Integration event type |
| --- | --- |
| Product create | `catalog.product.created.v1` |
| Product rename | `catalog.product.renamed.v1` |
| Product activate | `catalog.product.activated.v1` |
| Product suspend | `catalog.product.suspended.v1` |
| Product resume | `catalog.product.resumed.v1` |
| Product archive | `catalog.product.archived.v1` |
| SKU create | `catalog.sku.created.v1` |
| SKU rename | `catalog.sku.renamed.v1` |
| SKU activate | `catalog.sku.activated.v1` |
| SKU suspend | `catalog.sku.suspended.v1` |
| SKU resume | `catalog.sku.resumed.v1` |
| SKU retire | `catalog.sku.retired.v1` |

The v1 event envelope has exactly these required members: canonical UUIDv7
`eventId`; one allow-listed `eventType` above; integer `schemaVersion` equal to
1; canonical six-digit UTC `occurredAt`; `aggregateType` equal to `PRODUCT` or
`SKU`; canonical UUIDv7 `aggregateId`; positive integer `aggregateVersion`;
validated UUIDv4/v7 `correlationId`; canonical UUIDv7 `causationId` identifying
the durable command record; and `payload`.

A Product payload has exactly `productId`, `name`, `status`, and `updatedAt`.
An SKU payload has exactly `skuId`, `productId`, `code`, `name`, `status`, and
`updatedAt`. Identifiers and timestamps use the canonical formats from this
contract; status is the resulting aggregate status. Events contain no actor,
session, credential, permission, reason code, arbitrary metadata, or diagnostic
value. A validated same-value rename and an idempotency replay emit no domain
or integration event.

## Verification strategy

The implementation is not complete until tests prove:

- every permitted and forbidden domain transition;
- terminal immutability and same-value rename behavior;
- strict DTO, header, UUID, Unicode, code, reason-code, and response schemas;
- authentication before lookup and authorization before replay;
- exact per-operation `401`, `403`, `409`, `412`, `428`, `500`, and `503`
  behavior, including the sole allow-listed Bearer challenge;
- two concurrent updates with one expected version produce one success;
- concurrent duplicate SKU codes produce one durable SKU;
- SKU activation/resume and Product archival obey Product-first locking;
- same-key replay, different-fingerprint conflict, and concurrent duplicate
  behavior;
- aggregate, audit, outbox, and idempotency effects roll back together;
- every real mutation emits exactly its mapped v1 event, while no-ops and
  replays emit none;
- audit access, retention cutoff, legal hold, and bounded purge behavior;
- real MySQL enforces the revised lifecycle and timestamp constraints;
- no Redis or RabbitMQ outage can create or repeat a committed mutation;
- OpenAPI exactly matches runtime routes, headers, bodies, permissions, and
  failures.

## Why this design

- Explicit aggregate operations make lifecycle legality independently
  testable and keep transport fields out of the domain.
- Product-level effective visibility permits bounded family publication and
  suspension without a large SKU transaction.
- Permission checks preserve least privilege between editing and publication.
- Durable idempotency handles lost responses; optimistic versions handle
  competing intent. Neither mechanism replaces the other.
- Atomic audit and outbox writes make accountability and downstream delivery
  consequences of the same committed fact.

## Alternatives and trade-offs

- **Unauthenticated or API-key administration:** faster to demonstrate but
  fails attribution, revocation, and least-privilege requirements.
- **Generic status PATCH:** superficially REST-like but makes illegal
  transitions, reasons, permissions, and audit action names implicit.
- **Pessimistic locking for every edit:** simple conflict reasoning but holds
  locks while ordinary administrators think and retry; optimistic versions are
  sufficient for bounded updates.
- **Product archive cascades to SKUs:** produces matching row statuses but
  creates an unbounded cross-root transaction.
- **Redis idempotency:** lowers lookup latency but cannot remain correct through
  eviction or an outage.
- **Publish RabbitMQ directly:** avoids an outbox worker but reintroduces the
  commit/publish crash window.
- **Return `204` after mutation:** sends fewer bytes but forces another read to
  obtain the new version and representation.

The chosen design creates more tables, headers, error cases, and operational
work than a CRUD controller. That cost is deliberate: administrative retries,
concurrent edits, security attribution, and event publication are observable
production behavior rather than framework details.

## Interview questions

1. Why are Product and SKU separate aggregates if public visibility depends on
   both?
2. Why can an active SKU remain hidden beneath a non-active Product?
3. What different failures do `Idempotency-Key` and `If-Match` prevent?
4. Why does an idempotency replay run authorization again?
5. Why are audit and outbox records part of the business transaction while
   RabbitMQ publication is not?
6. Why is Product-first locking needed only for bounded cross-root checks?
7. Why does a lifecycle action use an explicit route instead of writable
   status?

## Future improvements

- Add bounded administrative list and search contracts when the web client
  defines filtering and ordering needs.
- Add scheduled publication as a separate command and worker-owned workflow.
- Add provider-scoped external references when Catalog import is approved;
  do not overload SKU code or invent a global Product slug.
- Add bulk import through an asynchronous job contract with per-item outcomes,
  not an unbounded HTTP transaction.
- Add moderation-specific hold types only when separate policy owners require
  them.
- Revisit signed access tokens if independently deployed services need local
  authorization decisions and the revocation trade-off is accepted.
