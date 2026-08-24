# ADR 0005: Optimize the showcase deployment for zero hosting cost

Status: accepted

## Context

The project must be publicly demonstrable without paid infrastructure. A portfolio showcase has different availability expectations from a commercial production deployment.

## Decision

Export Next.js as static assets and serve it from the API origin. Deploy the API/static bundle and worker with the smallest viable connection pools against free hosted MySQL, Redis-compatible, and RabbitMQ services. Keep deployment configuration provider-thin and secrets external.

A deployment is complete only after migrations and the hosted order/payment/notification smoke workflow pass. Cold starts, quotas, and lack of SLA must be disclosed.

## Consequences

- Same-origin delivery simplifies CORS, cookies, and the number of public services.
- Static export removes the need for a Next.js server but excludes SSR-only features.
- Free-tier sleeping and connection limits can make the demo slow or temporarily unavailable.
- The worker may need a platform-specific co-location compromise if a free background service is unavailable.
- This architecture is a showcase target, not the claimed production operating model.

## Alternatives

- A separately hosted frontend provides independent CDN deployment but adds origin/cookie configuration without current benefit.
- Paid managed services provide backups, high availability, private networking, and predictable capacity, but violate the zero-cost constraint.
- Running all dependencies in one free container risks data loss and poor isolation; managed free data services are preferred when available.

## Revisit when

Free-tier terms change, the public demo becomes unreliable, or the system handles real user/business data. Any real workload requires a funded production architecture and operations plan.
