# Operational health

## Contract

Operational health is a deployment contract, not a business API. Its paths do
not inherit the `/api/v1` prefix and its responses contain no credentials,
connection details, exception messages, stack traces, uptime, or build data.

| Endpoint and state | HTTP status | Dependency behavior |
| --- | ---: | --- |
| `GET /health/live` while serving | `200` | No dependency is probed |
| `GET /health/ready` with MySQL available | `200` | Executes a bounded database probe |
| `GET /health/ready` with MySQL unavailable or timed out | `503` | Reports only that `database` is down |

Both endpoints send `Cache-Control: no-cache, no-store, must-revalidate`.
Liveness proves that the process can answer HTTP. Readiness determines whether
the process can safely receive application traffic.

## Database lifecycle

The composition root loads local development environment values when present,
parses API and database configuration once, resolves secret files, and closes
over the resulting typed database options in a NestJS provider factory.
Configuration errors stop startup before the API binds a socket.

Each API process owns one application-scoped `DatabaseConnection`. Prisma is
private to `@oms/database`; the NestJS module, shutdown hook, and health
indicator depend only on the narrow facade. Database probes are bounded and
concurrent probes share the same in-flight driver operation. Nest closes the
facade after the HTTP server has stopped accepting and draining requests, and
the facade makes repeated closure safe.

Startup intentionally does not require a successful database connection. A
live but unready process can recover when MySQL returns without entering a
restart loop, provided the deployment target respects readiness.

Terminus marks an already admitted health request as `shutting_down` if it
completes after shutdown begins. New connections are not guaranteed a response
once Nest starts closing the HTTP server; a future deployment-drain policy will
define and test that interval explicitly.

## Why this design

- Liveness and readiness drive different actions: restart an unhealthy process
  versus remove an otherwise recoverable process from traffic.
- MySQL is authoritative and required by synchronous application behavior, so
  it belongs in API readiness.
- Stable unversioned paths let deployment tooling survive business API version
  changes.
- Sanitized responses prevent operational endpoints from becoming an
  infrastructure-discovery or credential-leak surface.
- A bounded, single-flight probe prevents a slow dependency and frequent
  polling from exhausting the connection pool.

Redis is an optional acceleration layer. RabbitMQ publication is decoupled from
API transactions by the outbox. Their outages must be observable, but neither
currently makes synchronous API traffic unsafe; they therefore do not belong
in API readiness. Worker runtimes will have separate readiness policies for
the dependencies required by their workloads.

## Alternatives considered

- **One `/health` endpoint:** rejected because it conflates restart and
  traffic-routing decisions.
- **Versioned `/api/v1/health` paths:** rejected because operations contracts
  should not change with business contracts.
- **Terminus's Prisma-specific indicator:** rejected because it would expose
  the persistence implementation beyond the database boundary and duplicate
  timeout behavior.
- **Redis and RabbitMQ in API readiness:** rejected under the accepted cache and
  outbox failure policies. This decision must change if future synchronous
  requests require either dependency.
- **Connect to MySQL before binding HTTP:** rejected because recoverable
  database outages would cause startup crash loops instead of a stable unready
  state.

## Trade-offs

- A process can remain alive while unable to serve business traffic, so a
  deployment that ignores readiness is unsafe.
- A shallow liveness check cannot identify every event-loop stall or internal
  deadlock.
- Sanitized responses require separate internal logs, metrics, and traces for
  diagnosis.
- Readiness polls consume database capacity. Bounded, coalesced probes mitigate
  this, while deployment probe frequency still needs an explicit capacity
  budget.

## Interview questions

1. **Why separate liveness and readiness?** Liveness decides whether to restart
   a process; readiness decides whether to route traffic to it.
2. **Why is MySQL included but Redis and RabbitMQ are excluded?** MySQL is
   required for authoritative synchronous decisions. Redis is optional and
   RabbitMQ outages are absorbed by the transactional outbox.
3. **Why not inject Prisma into the health indicator?** Depending on the
   application-owned facade preserves dependency inversion and prevents
   framework diagnostics from defining the persistence boundary.
4. **Why bound and coalesce probes?** It limits outage latency, avoids a
   thundering herd, and protects the database pool from health-check traffic.
5. **Why can the API start before MySQL is reachable?** Readiness can gate
   traffic while the same process recovers, avoiding unnecessary restart
   churn.

## Future improvements

- Add rate-limited structured probe-failure logs and readiness metrics.
- Alert on readiness latency and failure rate using defined SLOs.
- Add Kubernetes startup, readiness, liveness, and termination-drain tests.
- Define RabbitMQ readiness for publisher and consumer worker runtimes.
- Provide authenticated deep diagnostics separately from public health.
- Set SLO-driven probe intervals and a database capacity budget.
