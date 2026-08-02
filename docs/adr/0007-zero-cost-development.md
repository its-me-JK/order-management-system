# ADR-0007: Keep development and demonstration infrastructure at zero cost

- **Status:** Superseded by [ADR-0008](0008-zero-cost-public-showcase.md)
- **Date:** 2026-08-02

## Context

This portfolio project must not generate infrastructure charges. It still needs
production-oriented architecture, realistic database behavior, and automated
verification. Cloud free tiers can expire, change terms, require a payment
method, or incur charges after a quota is crossed, so they do not satisfy a
strict zero-cost constraint.

## Decision

Run MySQL, Redis, RabbitMQ, and other stateful development dependencies locally
through pinned Docker Compose services. Use ephemeral containers in CI and the
standard GitHub-hosted runners available to this public repository.

The AWS production topology remains a documented target architecture, not a
deployed environment. Do not provision AWS resources, managed databases,
third-party hosted services, paid runners, or products that require billing
details without a new ADR and explicit owner approval.

Production readiness is demonstrated through domain boundaries, migrations,
integration and concurrency tests, observability contracts, deployment
documentation, and failure-mode exercises. It is not represented as proof that
the project currently operates a highly available public production service.

## Consequences

### Positive

- Development remains reproducible without financial or billing risk.
- Real MySQL, Redis, and RabbitMQ semantics can be tested locally and in CI.
- The application is not coupled to a short-lived hosted free-tier provider.
- Future infrastructure costs remain an explicit decision rather than an
  accidental side effect.

### Negative

- There is no continuously available public demonstration environment.
- Local containers do not prove managed-service failover, multi-AZ networking,
  backup restoration, or cloud IAM behavior.
- Contributors need enough local CPU, memory, and disk for the dependency
  containers.
- AWS deployment documentation cannot be fully exercised while this constraint
  remains in force.

## Alternatives considered

- **AWS free tier:** rejected because eligibility and quotas vary, resources can
  outlive the free allowance, and accidental charges remain possible.
- **Hosted database free plans:** rejected because availability, limits, and
  lifecycle are controlled by an external provider and may change.
- **Self-host a public environment:** deferred because it adds networking,
  security, uptime, and hardware responsibilities without improving the current
  backend milestones.

## Revisit when

Revisit only if the repository owner explicitly approves a non-zero budget or
provides already-funded infrastructure with clear spending controls. A new ADR
must define the monthly ceiling, alerts, shutdown controls, and ownership before
anything billable is provisioned.

## References

- [GitHub Actions billing and usage](https://docs.github.com/en/actions/concepts/billing-and-usage)
