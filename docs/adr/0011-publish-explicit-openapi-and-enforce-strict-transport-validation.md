# ADR-0011: Publish explicit OpenAPI and enforce strict transport validation

- **Status:** Accepted
- **Date:** 2026-08-22

## Context

Business endpoints will be consumed by a web application and, eventually, by
external clients. Their transport contract must survive controller refactors,
support deterministic client generation, and make accidental response or route
changes visible in CI. NestJS route metadata alone does not define request
constraints, exact response bodies, media types, or stable operation names.

The API also needs one validation policy before the first feature controller is
introduced. Framework defaults can accept unknown properties, expose detailed
constraint messages, and coerce primitive values. Those behaviors create mass
assignment risk, leak implementation detail, and make client mistakes appear
valid. Transport validation still cannot own inventory, order, authorization,
or payment invariants.

The public showcase must cost nothing, avoid runtime third-party dependencies,
and expose useful documentation without turning a browser into an API mutation
client or publishing unnecessary package artifacts.

## Decision

Publish an application-owned OpenAPI 3.0.3 contract and enforce one strict
global NestJS validation boundary.

- Generate the OpenAPI document eagerly from compiled NestJS metadata during
  API startup, after prefix and versioning configuration and before listening.
  Metadata errors therefore fail startup rather than the first documentation
  request.
- Keep code-first route discovery, but make application-owned decorators and
  explicit schemas authoritative. Do not enable the Nest Swagger AST plugin
  yet; build-time inference and Jest metadata must not produce different
  contracts.
- Serve a public read-only Swagger UI at `GET /docs` and JSON only at
  `GET /docs/openapi.json`. These documentation resources are unversioned while
  business paths inside the document remain versioned.
- Construct the Express adapter with case-sensitive routing before NestJS
  registers middleware or routes. Alternate path casing is not an alias;
  trailing-slash tolerance is unchanged.
- Bundle UI assets from the installed dependency. Allow only the CSS,
  JavaScript, preset, initialization, and favicon files required by the UI.
  Package metadata, source maps, OAuth helpers, YAML, and framework-default
  aliases remain closed behind the standard Problem Details `404` boundary.
- Apply `Cache-Control: no-store` and server-owned request identity to every
  documentation representation. Publish no environment-specific server URL
  and perform no MySQL probe while generating or serving the document.
- Disable submit methods, Try It Out, persisted authorization, query-based
  configuration, and the remote validator. The UI is a viewer, not an API
  console or a source of outbound browser requests.
- Require every operation to declare a unique lower-camel-case operation ID.
  The fallback emits an invalid sentinel, and startup validation rejects
  missing, generated, malformed, or duplicate identifiers.
- Disable Terminus's broad generated Swagger schemas while retaining its
  runtime health behavior. Publish the application's exact canonical `200`,
  `503`, and safe Problem Details `500` health representations instead.
- Publish an exact reusable seven-member `ProblemDetails` schema. Each
  status-specific response narrows fields whose values are fixed by the runtime
  contract.
- Register one application-scoped global `ValidationPipe`. It rejects unknown
  properties and unknown root values; validates required, null, and undefined
  values; stops after the first constraint failure per property; and emits a fixed
  `BadRequestException` without rejected values or validation details.
- Do not globally transform request values or implicitly coerce primitives.
  A JSON string is not accepted as a number or boolean merely because a
  controller parameter has that TypeScript type. Deliberate normalization must
  be local, explicit, and tested.
- Transport request DTOs are concrete decorated classes. Every accepted field
  has validation metadata; nested DTOs declare both nested validation and
  concrete transformation metadata so class-validator can inspect them. A
  property representing one nested object also declares an object-shape
  constraint because nested validation alone accepts arrays.
- Use class-transformer `@Type` only to materialize nested DTO classes.
  Primitive `@Type` and `@Transform` metadata can still alter values during
  validation even when the global pipe has `transform: false`; they require an
  explicit endpoint contract and focused coercion tests before use.
- Custom Nest parameter decorators do not inherit this DTO guarantee. They
  require an explicit local pipe and tests, or a later reviewed change to the
  global custom-decorator policy.
- Keep Swagger and validation imports in presentation/platform adapters.
  Domain and application layers remain independent of NestJS transport types.
  DTO validation establishes shape and bounded syntax; use cases and aggregates
  still enforce business invariants.
- Pin direct runtime dependencies and deny unapproved optional analytics or
  telemetry install scripts. Documentation requires neither a hosted service
  nor a paid account.

## Consequences

### Positive

- The executable API surface, exact health responses, and Problem Details
  envelope are discoverable through one deterministic contract.
- Stable operation IDs protect generated clients from implementation-only
  controller and method renames.
- Strict rejection prevents unknown client data from silently reaching
  application code and makes type mistakes visible immediately.
- Validation failures reuse the secret-safe error and observability boundary.
- Documentation remains useful in a public zero-cost deployment without
  database traffic, third-party scripts, or interactive mutation controls.

### Negative

- Explicit schemas duplicate some runtime response and DTO knowledge, so
  contract tests are required to detect drift.
- Startup now fails for invalid OpenAPI metadata. This is intentional, but a
  documentation defect can prevent a release from serving traffic.
- Rejecting unknown fields and wrong primitive types is less tolerant of stale
  or loosely typed clients.
- Disabling global transformation means controller parameters are validated
  plain values, not behavior-bearing DTO instances. DTOs must remain transport
  schemas rather than domain objects.
- Public documentation reveals the intended public surface. Authorization and
  rate limiting must still protect future endpoints; hiding documentation is
  not a security boundary.
- A read-only UI is less convenient for manual experimentation than an
  interactive API console.

## Alternatives considered

- **Design-first OpenAPI YAML:** gives the specification stronger independence
  from framework code, but creates route/spec synchronization overhead before
  external contract governance or client generation exists. Revisit when API
  consumers need contract-first review.
- **Nest Swagger AST inference:** reduces decorators, but makes the emitted
  contract depend on a build plugin that is not applied by the current Jest
  path and can hide consequential schema decisions.
- **Generate the document per request:** supports request-specific servers but
  adds runtime work, permits environment drift, and delays metadata failures.
- **Public interactive Swagger:** convenient for developers, but unnecessarily
  permits browser-issued mutations and future credential persistence on a
  showcase surface.
- **Private or externally hosted documentation:** reduces disclosure or API
  process surface, but adds access management, drift, cost, or another runtime
  dependency. Endpoint authorization remains mandatory either way.
- **Silently strip unknown properties:** improves forward compatibility but
  hides client defects and can make a misspelled security- or money-relevant
  field appear accepted.
- **Enable global transformation or implicit conversion:** convenient for
  primitive query and path inputs, but accepts ambiguous values and applies one
  coercion policy across unrelated endpoints.
- **Use Zod or another schema-first validator now:** could unify runtime and
  documentation schemas, but adds a second Nest adapter and migration cost
  before real feature DTOs expose a limitation in the native validation path.

## Revisit when

Revisit when the first public client is generated, the API is governed by a
separate contract-review workflow, structured validation violations are
required, multiple public/internal documents exist, or explicit endpoint-local
normalization becomes repetitive. Any move to OpenAPI 3.1+, AST inference,
schema-first validation, or an interactive authenticated console requires
compatibility and security tests first.

## References

- [OpenAPI Specification 3.0.3](https://spec.openapis.org/oas/v3.0.3.html)
- [NestJS OpenAPI introduction](https://docs.nestjs.com/openapi/introduction)
- [NestJS validation](https://docs.nestjs.com/techniques/validation)
- [ADR-0010: Standardize public HTTP errors with RFC 9457](0010-standardize-http-errors-with-rfc-9457.md)
