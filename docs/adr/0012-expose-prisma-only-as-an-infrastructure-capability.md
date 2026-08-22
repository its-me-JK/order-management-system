# ADR-0012: Expose Prisma only as a runtime-owned infrastructure capability

- **Status:** Accepted
- **Date:** 2026-08-22

## Context

ADR-0006 requires one Prisma client and connection pool per runtime while each
business module owns its repositories. The first database implementation
exposed only a narrow `DatabaseConnection` for readiness and shutdown. That
was sufficient before business persistence existed, but a Prisma repository
also needs access to the same runtime-owned client.

Creating a second client for a feature module would duplicate its pool and
make the process connection budget inaccurate. Exposing Prisma from the
general database package entrypoint would instead let transport, application,
or domain code couple itself to generated models and persistence errors.

## Decision

Create one application-scoped `DatabaseRuntime` at each process composition
root. The runtime owns the Prisma client, its pool, and the narrow lifecycle
connection.

- The general `@oms/database` entrypoint creates the runtime and exposes only
  Prisma-independent runtime, connection, and configuration contracts.
- The runtime exposes its `DatabaseConnection` for health probes and one
  idempotent close operation for process shutdown. Closing either lifecycle
  view reaches the same underlying disconnect operation.
- An explicit `@oms/database/prisma` subpath is the only supported way to
  recover the concrete client. That subpath is an infrastructure capability,
  not a business or transport API.
- The NestJS database composition module creates the runtime once, derives the
  health connection and Prisma-client providers from that same instance, and
  never calls a second client factory.
- Only database composition roots and module infrastructure adapters may
  import the Prisma capability, generated Prisma paths, or Prisma runtime
  packages. ESLint enforces the restriction for static and dynamic imports.
- Domain and application layers depend on module-owned repository and
  unit-of-work ports. Presentation code cannot inject the Prisma client.
- Persistence adapters do not disconnect the shared client. The runtime owns
  shutdown exactly once after the application stops accepting work.

This refines the implementation of ADR-0006; it does not change module data
ownership or authorize an adapter to query another module's tables.

## Consequences

### Positive

- Health checks and business repositories share one measured connection pool.
- Prisma remains absent from the public database contract and inward-facing
  business layers.
- Runtime creation and shutdown have one explicit owner and are directly
  testable.
- Future API and worker runtimes can reuse the same lifecycle without creating
  a client per module.

### Negative

- Composition code needs separate providers for the runtime, health facade,
  and concrete client.
- The generated client still contains every model, so linting, tests, review,
  and module-owned adapters must enforce logical table ownership.
- Focused infrastructure tests need the restricted Prisma entrypoint to build
  a runtime around a test client.
- Compile-time import restrictions cannot prevent deliberate runtime evasion;
  repository review remains part of the boundary.

## Alternatives considered

- **One Prisma client per module:** visually strengthens ownership but
  duplicates pools and prevents straightforward local cross-module
  transactions.
- **Export Prisma from `@oms/database`:** is convenient but turns an
  infrastructure implementation into a repository API available everywhere.
- **Put all repositories in the database package:** centralizes access at the
  cost of surrendering bounded-context ownership.
- **Expose a generic query or repository facade:** either recreates Prisma
  poorly or leaks its query semantics through a different type.
- **Pass the client through application ports:** makes transaction plumbing
  easy but directly couples business contracts to the ORM.

## Revisit when

Revisit if a module is physically extracted, Prisma provides a capability-safe
client with model-level access controls, or separate database credentials and
pools become a measured isolation requirement. Preserve explicit runtime
ownership and inward-facing Prisma-independent contracts in any replacement.
