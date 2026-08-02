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

## Template

New records use the next four-digit sequence number and start from
[`template.md`](template.md). They contain:

1. Title, status, and date.
2. Context and forces.
3. Decision.
4. Consequences, including negative consequences.
5. Alternatives considered.
6. Conditions that would justify revisiting the decision.
