# ADR-0008: Operate a zero-cost public showcase environment

- **Status:** Accepted
- **Date:** 2026-08-02
- **Supersedes:** [ADR-0007](0007-zero-cost-development.md)

## Context

The project owner requires a public URL that can be shared with reviewers while
retaining the hard constraint that the project must not incur charges. The
local-first decision in ADR-0007 prevents accidental billing, but it also
explicitly rejects the continuously reachable showcase now required.

No free service can honestly provide production availability, fixed capacity,
or permanent commercial terms. Some free services sleep, suspend inactive
resources, limit throughput, or withdraw plans. The code and verification
environment must therefore remain production-oriented without presenting the
hosted demonstration as a production deployment.

## Decision

Maintain three distinct environment classes:

- **Local development:** pinned MySQL, Redis, and RabbitMQ containers remain the
  canonical environment for infrastructure semantics and failure testing.
- **CI:** ephemeral real dependencies verify migrations and integration
  behavior without retaining state.
- **Public showcase:** no-card free services provide a stable public URL for
  synthetic demonstration data, with their limitations documented.

The public showcase follows these rules:

- Do not deploy the empty scaffold. The first public release requires health
  endpoints, validated configuration, reviewed migrations, OpenAPI, security
  controls, synthetic seed data, and at least one meaningful vertical slice.
- Use only plans that require no payment method and cannot automatically create
  a charge. Trial credits, authorization holds, usage-based billing accounts,
  and automatic paid upgrades are prohibited.
- The current API target is a Render Free web service. The current database
  target is Aiven for MySQL Free with MySQL 8.4 selected explicitly. Redis Cloud
  Free and CloudAMQP Little Lemur are the candidates when those capabilities
  become part of the deployed slice.
- Revalidate provider terms, limits, supported versions, and card requirements
  immediately before provisioning. A provider may be replaced without a new
  ADR when the replacement preserves every rule in this decision.
- Keep API and worker runtimes separate. Do not hide a missing free worker tier
  by moving worker responsibilities into the API. The hosted showcase may
  expose fewer asynchronous capabilities than the canonical local environment
  until an acceptable worker target is verified.
- Run committed migrations through a dedicated deployment job before the new
  application release. The application never migrates on startup.
- Store secrets only in GitHub and provider secret stores. Database and broker
  connections over public networks require TLS, separate runtime and migration
  credentials, and least privilege.
- Deploy only synthetic data. Do not store real personal, payment, or secret
  data in the showcase.
- Label the environment `showcase` or `demo` in documentation and telemetry.
  Never claim that a sleeping, single-node, no-SLA free tier is production.
- Do not generate artificial traffic merely to evade an inactivity policy.

Provider-specific deployment manifests belong in the repository, but provider
credentials and resource identifiers do not. The documented AWS topology
remains a future production target and is not provisioned under this decision.

## Consequences

### Positive

- Reviewers receive a shareable HTTPS URL without financial or billing risk.
- MySQL 8.4 remains the authoritative database technology in local, CI, and
  showcase environments.
- Provider limitations do not leak into domain or application boundaries.
- The project can demonstrate CI-controlled migrations and deployment without
  pretending to operate a highly available production system.

### Negative

- Cold starts can delay the first request, and inactive services may require
  manual reactivation.
- The showcase has no availability SLA, fixed region, private network, or
  guaranteed retention.
- Multiple free providers add operational fragmentation and public-network
  latency.
- A complete always-on API and worker topology might not be possible while the
  zero-cost and no-card constraints remain in force.
- Provider terms must be rechecked and the deployment may need to move.

## Alternatives considered

- **Remain local-only:** preserves exact infrastructure behavior but fails the
  requirement for a link that reviewers can open.
- **Expose a laptop through a tunnel:** useful for a scheduled interview demo,
  but availability still depends on the laptop, power, and home connection.
- **Use a card-backed cloud free tier:** can provide more complete compute but
  introduces authorization holds or accidental-charge risk.
- **Adapt the backend to request-only edge functions:** improves access to free
  compute but distorts the long-running NestJS and RabbitMQ worker architecture.
- **Co-locate the API and worker:** saves one free compute instance but removes
  the independent failure and scaling boundary accepted in ADR-0002.

## Revisit when

Revisit if no compliant provider can host a meaningful showcase, a provider
requires payment details, the free environment repeatedly harms the reviewer
experience, or the owner approves a bounded non-zero budget. Any paid decision
must define a monthly ceiling, alerts, hard shutdown controls, and ownership.

## References

- [Render free service limitations](https://render.com/docs/free)
- [Aiven for MySQL free tier](https://aiven.io/docs/products/mysql/concepts/mysql-free-tier)
- [Aiven MySQL version management](https://aiven.io/docs/products/mysql/howto/manage-mysql-version)
- [Redis Cloud free database](https://redis.io/docs/latest/operate/rc/databases/create-database/create-free-database/)
- [CloudAMQP plans](https://www.cloudamqp.com/plans.html)
