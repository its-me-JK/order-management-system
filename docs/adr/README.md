# Architecture Decision Records

Architecture Decision Records preserve important decisions together with their
context and consequences. They explain why the repository has a particular
shape without turning current implementation details into unwritten rules.

## Status values

- **Proposed:** under active review and not yet binding.
- **Accepted:** the current decision and expected implementation direction.
- **Superseded:** replaced by a newer ADR, which must be linked.
- **Deprecated:** retained for history but no longer recommended.

Accepted records are immutable apart from spelling, formatting, or link fixes.
A material change requires a new ADR that supersedes the old one.
When a new ADR supersedes only named clauses, the original remains Accepted for
its other decisions; both records and this index must identify the exact
partial-supersession relationship.

## Index

| ADR | Status | Decision |
| --- | --- | --- |
| [0001](0001-modular-monolith.md) | Accepted | Start with a modular monolith |
| [0002](0002-api-and-worker-runtimes.md) | Accepted | Separate API and worker runtimes |
| [0003](0003-inventory-consistency.md) | Accepted | Keep inventory correctness in MySQL |
| [0004](0004-transactional-outbox.md) | Accepted | Use a transactional outbox for integration events |
| [0005](0005-pnpm-workspace.md) | Accepted | Use a native pnpm workspace |
| [0006](0006-persistence-boundaries.md) | Accepted | Centralize persistence infrastructure without surrendering module ownership |
| [0007](0007-zero-cost-development.md) | Superseded | Keep development and demonstration infrastructure at zero cost |
| [0008](0008-zero-cost-public-showcase.md) | Accepted | Operate a zero-cost public showcase environment |
| [0009](0009-validate-runtime-configuration-at-boundaries.md) | Accepted | Validate runtime configuration at process boundaries |
| [0010](0010-standardize-http-errors-with-rfc-9457.md) | Accepted | Standardize public HTTP errors with RFC 9457; authenticated `401` deferral partially superseded by ADR-0015 |
| [0011](0011-publish-explicit-openapi-and-enforce-strict-transport-validation.md) | Accepted | Publish explicit OpenAPI and enforce strict transport validation |
| [0012](0012-expose-prisma-only-as-an-infrastructure-capability.md) | Accepted | Expose Prisma only as a runtime-owned infrastructure capability |
| [0013](0013-model-catalog-products-and-skus-separately.md) | Accepted | Model Catalog Products and SKUs separately; lifecycle policy partially superseded by ADR-0014 |
| [0014](0014-support-staged-and-reversible-catalog-publication.md) | Accepted | Support staged and reversible Catalog publication; supersedes ADR-0013 lifecycle policy |
| [0015](0015-authenticate-and-authorize-administrative-apis.md) | Accepted | Authenticate and authorize administrative APIs; supersedes ADR-0010 authenticated `401` deferral when delivery gates are complete |
| [0016](0016-make-retryable-commands-durably-idempotent.md) | Accepted | Make retryable commands durably idempotent |
| [0017](0017-use-split-browser-session-credentials.md) | Accepted | Use split browser session credentials and refine the ADR-0015 HTTP delivery gate |
| [0018](0018-own-security-critical-mysql-connections.md) | Accepted | Own connections for security-critical MySQL transactions and refine the ADR-0006/ADR-0012 persistence lifecycle |

## Template

New records use the next four-digit sequence number and start from
[`template.md`](template.md). They contain:

1. Title, status, and date.
2. Context and forces.
3. Decision.
4. Consequences, including negative consequences.
5. Alternatives considered.
6. Conditions that would justify revisiting the decision.
