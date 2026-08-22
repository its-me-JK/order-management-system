# OpenAPI and transport validation

## Scope

This contract owns discovery and structural validation at the API's HTTP
boundary. It does not define business workflows, authorize a caller, verify
cross-field domain rules, or make generated documentation a runtime validator.

The implementation follows
[ADR-0011](../adr/0011-publish-explicit-openapi-and-enforce-strict-transport-validation.md).

## Published endpoints

| Endpoint | Representation | Policy |
| --- | --- | --- |
| `GET /docs` | Read-only Swagger UI | Required local assets only, no submit methods, no persisted authorization, no remote validator, `no-store` |
| `GET /docs/openapi.json` | OpenAPI 3.0.3 JSON | Deterministic, environment-neutral, dependency-free, `no-store` |

Documentation is an unversioned platform resource. Versioned business paths
inside the document remain under `/api/v1`; operational health remains
unversioned. `/api/docs`, `/api/v1/docs`, `/docs-json`, `/docs-yaml`, and
`/docs/openapi.yaml` are not aliases.

Paths are case-sensitive because the Express application is configured before
NestJS registers its router. `/DoCs`, `/DOCS/openapi.json`, and alternate case
for future API paths are not aliases. Trailing-slash tolerance is unchanged.

The UI allow-list contains only its CSS, JavaScript bundle, standalone preset,
initialization script, and favicons. Source maps, dependency metadata, OAuth
redirect helpers, and other files shipped by `swagger-ui-dist` return the
ordinary safe `404` Problem Details response. This avoids publishing a package
directory merely because the required UI files are local.

Every docs response passes through the existing request identity and access-log
boundary. Contract generation and delivery never call the database. The JSON
contains no absolute deployment host, environment value, credential, database
topology, or generated probe result.

## Contract ownership and generation

Nest controllers remain the route source of truth. The composition root
configures `/api`, URI versioning, and version-neutral health paths before it
eagerly creates the document. Only the registered `ApiModule` graph is scanned,
so test-only controllers cannot enter the public specification.

The application explicitly owns:

- operation IDs, summaries, tags, media types, responses, and headers;
- exact operational-health schemas;
- reusable request-identity, cache, and Problem Details components; and
- startup validation of contract invariants.

The Swagger AST plugin is deliberately disabled. Explicit decorators are more
verbose, but the compiler, Jest, and runtime all observe the same metadata.
Swagger imports remain in controllers and platform presentation adapters;
domain entities, use cases, repository ports, and Prisma models do not depend
on them.

The document is generated once for the process. Request-specific `servers` are
not inferred from `Host` or forwarding headers. Deployment targets can expose
the same relative contract without producing environment-specific artifacts or
trusting an unvalidated proxy header.

## Operation-ID rules

Every HTTP operation declares one globally unique lower-camel-case identifier.
Identifiers describe the stable client action rather than a TypeScript class or
method, for example `healthGetReadiness` and, later, `ordersCreate`.

The configured fallback begins with `UNSPECIFIED_`. Startup rejects any
fallback, missing identifier, nonconforming identifier, or duplicate. Renaming
a controller therefore does not silently rename a generated SDK method, while
forgetting the explicit contract prevents an invalid release from starting.

## Schema and response rules

Response schemas describe the representation the adapter actually permits,
not the broadest shape a dependency might return.

- Health `200` and `503` schemas require all four Terminus envelope members,
  exact component names and statuses, and no additional properties.
- Health `500` uses `application/problem+json` and the fixed internal-error
  Problem Details component.
- The reusable Problem Details schema has exactly `type`, `title`, `status`,
  `detail`, `instance`, `requestId`, and `correlationId` as required members.
- Reusable response headers describe server-owned request/correlation IDs and
  exact cache policy values.
- A future operation declares only statuses and media types it can actually
  produce. Generic catch-all response declarations are not a substitute for
  explicit failure mapping.

Terminus's Swagger integration is disabled because its generic component maps
allow data that the runtime health adapter intentionally rejects. Terminus
continues to own its runtime health-check marker and no-cache header.

## Public read-only documentation posture

The OpenAPI description is public because it is a client contract, not a
secret. Endpoint authentication and authorization must remain correct even
when every route is known.

The UI cannot submit HTTP operations, retain authorization, accept query-driven
configuration, or contact the optional online validator. Assets are supplied
by the API process from installed open-source dependencies. No SaaS
documentation account, CDN, database, or paid hosting feature is required.

Public read-only documentation improves review and portfolio usability, but it
does increase HTTP surface. Future Content Security Policy and security-header
work must test the UI explicitly instead of weakening policy globally.

The future Identity surface adds one HTTP Bearer security scheme and one
refresh-cookie scheme exactly as specified in the
[Identity and session contract](identity-and-session.md). Protected business
operations declare Bearer security and a distinct lexicographically sorted
`x-oms-required-permissions` string array; every listed permission is required.
The extension is descriptive contract metadata and local permissions are not
mislabeled as OAuth scopes. Login, refresh, and logout document the cookie,
CSRF header, and exact Set-Cookie effects but do not make Swagger UI
interactive or permit it to persist a credential.

## Zero-cost and supply-chain posture

Swagger UI and the JSON document are served by the existing API process from
pinned open-source packages. They require no SaaS account, CDN, object storage,
database, or separate deployment. This adds no hosting line item to the
approved zero-cost showcase topology.

The dependency graph includes an optional Scarf install script. The pnpm
allow-build policy explicitly denies that script, so installing documentation
dependencies cannot run its analytics/telemetry hook. Prisma and other reviewed
native build steps remain separately allow-listed; disabling all dependency
scripts globally would break legitimate generated artifacts without providing
a reviewed per-package policy.

## Strict DTO validation contract

One dependency-injected global pipe applies the same policy to every
controller, including controllers composed in tests:

- `whitelist: true` and `forbidNonWhitelisted: true` reject unknown members;
- `forbidUnknownValues: true` rejects values that are not valid DTO roots;
- missing, `null`, and `undefined` values are not skipped;
- only the first failing constraint per property needs to be evaluated;
- rejected targets, values, field names, and constraint details are not
  exposed through the exception; and
- `transform: false` prevents Nest from returning DTO instances and disables
  its global primitive-parameter coercion.

An invalid request produces the fixed seven-member RFC 9457 `400` response and
does not invoke the controller. Its body and logs never echo the rejected
payload. Top-level JSON primitives such as `null` may be rejected even earlier
by the strict JSON parser; they receive the same safe response when the
connection remains writable.

TypeScript types disappear at runtime. Every request body is therefore a
concrete class with class-validator metadata on every admitted property.
Nested objects require `@ValidateNested` plus explicit class-transformer type
metadata. A property representing one nested object also requires `@IsObject`;
`@ValidateNested` by itself accepts arrays. Nested collections instead declare
array bounds and element-wise nested validation. Interfaces, type-only DTOs,
undecorated properties, and broad `unknown` controller bodies do not satisfy
this boundary for feature commands.

Nest still builds a temporary class instance to perform validation and then
returns plain values. Explicit primitive `@Type` or `@Transform` decorators can
therefore coerce data despite `transform: false`; they are prohibited unless an
endpoint explicitly documents and tests that normalization. `@Type` is used by
default only for nested class materialization.

Custom Nest parameter decorators are not validated by this global pipe. A
future custom decorator must install and test an endpoint-local pipe or trigger
a reviewed change to the global custom-decorator policy; it cannot claim DTO
validation implicitly.

Before whitelist validation, Nest defensively removes the reserved
`__proto__`, `prototype`, and `constructor` keys at every depth. Those keys are
not reported as ordinary unknown-field failures, but they can never reach the
controller. All ordinary unknown fields are rejected. A custom pre-validation
rejector would add recursive parsing complexity without improving application
state safety, so this narrow framework defense is accepted and documented.

No implicit conversion means clients must send JSON values with the declared
type. Endpoint-local parsers may normalize path or query values only when the
contract explicitly documents the accepted syntax and tests both successful
and ambiguous inputs.

## Validation versus business invariants

DTO validation answers whether input has an allowed bounded transport shape.
It may check string length, UUID syntax, array bounds, enums, and nested object
shape. It must not decide whether stock exists, a price is current, a caller can
cancel an order, a state transition is legal, or an idempotency key conflicts.

Those rules belong to application authorization and domain models operating on
authoritative state. The controller maps a structurally valid DTO into an
application command; it does not pass the DTO into the domain as an entity.

## Failure behavior

OpenAPI metadata defects fail startup with a fixed internal error. They do not
produce a partial document. CI contract tests verify exact route exposure,
operation IDs, media types, reusable schemas, read-only UI configuration,
static-asset allow-listing, request identity, and lack of database probes or
environment leakage.

Validation failures are expected client errors. They produce one ordinary
completion log at `info`, no unexpected-exception event, and no controller
side effect. Unexpected validator or adapter failures remain subject to the
global fail-closed `500` policy.

## Why this design

- Code-first discovery keeps Nest routing and documentation aligned while
  explicit metadata makes consequential contract choices reviewable.
- Eager validation converts client-breaking metadata mistakes into release
  failures rather than runtime surprises.
- Exact health and Problem Details schemas match the application's sanitized
  response boundary instead of documenting vendor implementation detail.
- Strict non-coercive validation makes ambiguous input fail visibly and keeps
  mass-assignment fields out of application code.
- A public local-only viewer provides zero-cost portfolio value without
  outsourcing the contract or exposing an interactive credential-bearing UI.

## Alternatives

- **API-first YAML:** preferable when a separate contract team or external
  consumers require design review before implementation; currently it adds a
  second synchronization workflow.
- **Full inferred code-first schemas:** less repetitive but sensitive to build
  plugins and likely to conceal exact response decisions.
- **Schema-first validation such as Zod:** can reduce schema duplication, but
  introduces another adapter and should be justified by real DTO complexity.
- **Global transformation:** creates DTO instances and convenient primitive
  parsing, but Nest also transforms route/query primitives. The current policy
  favors explicit endpoint-local normalization.
- **Silently strip unknown members:** more permissive for clients but hides
  mistakes and weakens the mass-assignment boundary.
- **Private or interactive docs:** private docs add access operations; public
  interaction expands credential and mutation risk. Neither removes the need
  for real endpoint authorization.

## Trade-offs

- Explicit metadata can drift from DTO validation or runtime mapping. Focused
  contract tests and later client-generation checks carry that cost.
- Strict clients must update when fields are removed or renamed and cannot send
  speculative fields for a newer API version.
- Fixed `400` details are safer but less convenient for humans. Structured
  allow-listed violations may be introduced once a concrete client need and
  privacy policy exist.
- A metadata issue can make the API fail startup. This protects releases but
  makes OpenAPI tests part of the critical CI path.
- Swagger UI adds dependency and CSP maintenance even in read-only mode.

## Interview questions

1. **Why use explicit code-first metadata instead of full inference?** Route
   discovery stays aligned with Nest while response, media-type, and client-name
   choices remain intentional and identical across build and test paths.
2. **Why fail startup for invalid operation IDs?** Generated clients treat IDs
   as method names; silently changing or duplicating them is a contract defect,
   not a documentation warning.
3. **Why disable implicit conversion?** Ambiguous primitives should not become
   valid merely because framework metadata inferred a target type. Explicit
   parsing can have endpoint-specific syntax and errors.
4. **Why reject rather than strip unknown fields?** Rejection exposes client
   defects and prevents misspelled or attacker-supplied fields from appearing
   accepted.
5. **Why omit field-level validation messages?** Constraint names and rejected
   values create disclosure and coupling. The server can later publish a small,
   stable violations vocabulary if clients prove they need it.
6. **Why can documentation be public but non-interactive?** Route knowledge is
   not an authorization boundary, while browser-side submission and credential
   persistence add risks that a contract viewer does not need.
7. **Why must OpenAPI generation avoid dependency probes?** A descriptive
   artifact should be deterministic and available during dependency outages;
   generation must not turn documentation into readiness traffic.

## Future improvements

- Validate the emitted document with a pinned independent OpenAPI linter.
- Generate a typed frontend client only after the first stable business slice.
- Add response-contract tests for every business operation and enforce response
  completeness in CI.
- Publish stable application-specific problem type pages on the zero-cost
  documentation origin.
- Introduce controlled structured validation violations only with a client and
  privacy requirement.
- Evaluate OpenAPI 3.1+, schema-first DTOs, separate public/admin documents, and
  authenticated interactive tooling when interoperability evidence justifies
  them.
- Add a strict Content Security Policy and broader HTTP security headers while
  preserving the local documentation viewer.
