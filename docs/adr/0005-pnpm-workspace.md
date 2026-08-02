# ADR-0005: Use a native pnpm workspace

- **Status:** Accepted
- **Date:** 2026-08-02

## Context

The repository will contain two NestJS runtimes, multiple business modules, a
later Next.js application, and potentially extracted services. It needs real
dependency boundaries, deterministic installation, targeted commands, and a
layout that is not controlled by one application framework.

Nx, Turborepo, and Nest monorepo mode can all coordinate projects, but each
adds a repository model or task layer. The initial build graph is too small to
justify that operational surface.

## Decision

Use a native pnpm workspace with one root lockfile. The initial toolchain uses
the Node.js 24 LTS line and pnpm 11. Initial scaffolding pins the exact reviewed
patches in the repository, CI, and container builds; patch updates do not
require a new ADR.

The repository has these ownership rules:

- `apps/api` and `apps/worker` are private deployable applications and
  composition roots. They contain bootstrap and transport wiring, not business
  rules.
- Each implemented bounded context is a private workspace package under
  `packages/modules/<module>`. Empty module packages are not generated in
  advance.
- Cohesive platform packages may include `configuration`, `database`,
  `messaging`, `observability`, and `testing`.
- `shared-kernel` contains only stable universal concepts. It is not a generic
  utilities package.
- `contracts` contains compatibility-managed integration-event or external
  contract schemas. HTTP DTOs, domain objects, and internal application models
  do not become shared contracts by default.

Internal dependencies use the `workspace:*` protocol and package export maps.
Deep imports into another package's `src` tree and TypeScript aliases that
bypass exports are prohibited. Architecture tests enforce allowed dependency
directions because a package manager alone cannot enforce Clean Architecture.

Nest CLI may build or generate within an application, but Nest monorepo mode
does not define the repository layout. Initially, pnpm recursive/filter
commands and TypeScript's build facilities coordinate tasks. The root package
is private and owns repository-wide quality commands.

Version and installation policy:

- Commit one `pnpm-lock.yaml` and install with a frozen lockfile in CI.
- Pin pnpm exactly through the root `packageManager` field.
- Pin an exact Node patch in the developer-version file, CI, and production
  image; declare the supported major in `engines`.
- Use exact direct dependency versions and reviewed automated upgrade pull
  requests.
- Use root overrides only for documented security remediation or dependency
  convergence.
- Keep strict peer-dependency validation and one supported NestJS and Prisma
  version across the workspace.

## Consequences

### Positive

- Workspace packages provide enforceable import and dependency seams.
- pnpm gives strict dependency visibility and deterministic local linking
  without a second build-system abstraction.
- The layout accommodates NestJS, Next.js, workers, and future services.
- Nx or Turborepo can be added later without moving domain code.

### Negative

- The team must maintain architecture rules and a small amount of root task
  orchestration itself.
- Full repository checks run initially even when only one package changed.
- Many tiny packages would create configuration noise, so package creation
  requires a cohesive responsibility.

## Alternatives considered

- **Nx:** provides generators, affected graphs, tags, and remote caching, but
  introduces plugin and workspace coupling before several teams or deployables
  need it.
- **Turborepo:** is a good later task-cache layer, especially after Next.js,
  but it does not enforce module boundaries and currently offers little value
  over pnpm filtering.
- **Nest monorepo mode:** is convenient for Nest-only repositories but makes a
  framework-specific library/path model the repository architecture.
- **npm or Yarn workspaces:** are viable, but pnpm's strict dependency access,
  workspace protocol, and storage model better fit this boundary-heavy design.

## Revisit when

Evaluate Turborepo when measured CI duration or a meaningful frontend build
graph makes local or remote task caching valuable. Evaluate Nx when several
independently owned deployables would benefit from standardized generators and
tag-based dependency governance.

## References

- [Node.js release policy](https://nodejs.org/en/about/previous-releases)
- [pnpm workspace documentation](https://pnpm.io/workspaces)
- [pnpm installation and compatibility](https://pnpm.io/installation)
- [NestJS workspace modes](https://docs.nestjs.com/cli/monorepo)
