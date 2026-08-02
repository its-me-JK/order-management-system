# ADR-0009: Validate runtime configuration at process boundaries

- **Status:** Accepted
- **Date:** 2026-08-02

## Context

The API, worker, migration tooling, and tests will consume overlapping but
different configuration. Environment variables are untyped strings, and a
misspelled, empty, or malformed value can otherwise fail only after traffic
reaches a dependent capability. Secrets create an additional risk because a
generic validation error may echo their values into logs.

Nest's configuration module can validate environment variables, but exposing a
global string-keyed `ConfigService` would allow configuration lookups from any
layer. It would also couple policy that the API and worker share to a specific
application framework.

## Decision

Create a framework-neutral `@oms/configuration` workspace package. Each
deployable composition root parses its own explicit configuration profile once
during bootstrap and passes typed, narrow values to infrastructure providers.

The policy is:

- Define runtime schemas with the pinned Zod major used by the repository.
- Accept an environment-shaped input rather than reading `process.env` inside
  the package. Composition roots remain responsible for selecting the source.
- Return immutable configuration objects; application and domain code do not
  read environment variables or a global configuration service.
- Fail startup when a value required by that runtime is absent or invalid.
- Permit defaults only for non-secret values with safe local semantics.
- Report invalid variable names, never supplied values or resolved secrets.
- Keep API, worker, and migration profiles separate so one process does not
  require credentials for capabilities it does not use.
- Keep runtime database credentials distinct from DDL-capable migration
  credentials.

The first profile covers API process mode and HTTP port. Database, Redis,
RabbitMQ, and deployment-specific TLS fields will be added immediately before
their first runtime consumer, with tests for missing secrets and mutually
exclusive secret sources.

## Consequences

### Positive

- Invalid configuration fails deterministically before the process accepts
  traffic.
- Consumers receive typed values without framework or environment access.
- API and worker validation rules can be reused without making configuration a
  shared service locator.
- Tests can exercise schemas using plain objects and assert that errors are
  sanitized.

### Negative

- The configuration package becomes an upstream build dependency of each
  runtime.
- Profiles contain some repetition when two processes intentionally have
  different requirements.
- A schema library is retained in production dependencies for bootstrap-time
  validation.

## Alternatives considered

- **Global Nest `ConfigModule` and `ConfigService`:** convenient injection, but
  string-keyed lookups spread framework and configuration access through the
  codebase. A future Nest adapter may inject already-validated typed objects,
  but it will not own the policy.
- **Hand-written parsers in each application:** avoids a dependency, but
  duplicates coercion, range checks, defaults, and secret-safe error handling.
- **One schema for every runtime:** appears simpler, but makes the API require
  worker-only broker settings and makes migration credentials available to
  application processes.
- **Validate on first use:** can start a process with broken configuration and
  moves operational failures into request or message handling.

## Revisit when

Revisit the package boundary if configuration profiles remain runtime-specific
and share no policy, or if measured startup or bundle costs from schema
validation become material. Revisit the adapter approach if Nest modules need
scoped dynamic configuration after validated bootstrap objects are in place.

## References

- [Zod documentation](https://zod.dev/)
- [NestJS configuration techniques](https://docs.nestjs.com/techniques/configuration)
