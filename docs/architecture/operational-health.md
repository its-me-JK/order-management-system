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

Both endpoints receive server-owned request and correlation response headers.
Successful polls do not emit access logs. Failed readiness emits one sanitized
warning without the dependency exception. See
[Request identity and structured logging](request-identity-and-logging.md).

Expected failed readiness and graceful-shutdown responses remain outside the
public Problem Details contract. Their method-scoped adapter accepts only the
known exact Terminus shapes: database `down` for failed readiness, empty
component maps for liveness shutdown, and database exactly `up` or `down` for
readiness shutdown. It rejects accessors, proxies, extra fields, and
inconsistent component state, then reconstructs a canonical constant response.
A malformed health exception fails closed to the global RFC 9457 `500`
representation instead of serializing untrusted health data.

The OpenAPI document publishes these exact canonical `200`, `503`, and safe
Problem Details `500` representations, including the accepted readiness
shutdown alternatives and response headers. Terminus's generic Swagger
metadata is deliberately disabled because its arbitrary component maps permit
shapes that the runtime adapter rejects. The Terminus runtime decorator still
owns health execution metadata and the no-cache header. See
[OpenAPI and transport validation](openapi-and-transport-validation.md).

## Database lifecycle

The composition root loads local development environment values when present,
parses API and database configuration once, resolves secret files, and closes
over the resulting typed database options in a NestJS provider factory.
Configuration errors stop startup before the API binds a socket.

Each API process owns one application-scoped `DatabaseRuntime` and therefore
one Prisma client and pool. The NestJS composition module derives both the
infrastructure-only client provider and a narrow `DatabaseConnection` from
that same runtime. The shutdown hook and health indicator depend only on the
narrow facade; feature persistence adapters are the only consumers of the
client provider. Database probes are bounded and concurrent probes share the
same in-flight driver operation. Nest closes the runtime after the HTTP server
has stopped accepting and draining requests, and repeated closure through
either lifecycle view reaches the same disconnect operation. See
[ADR-0012](../adr/0012-expose-prisma-only-as-an-infrastructure-capability.md).

Startup intentionally does not require a successful database connection. A
live but unready process can recover when MySQL returns without entering a
restart loop, provided the deployment target respects readiness.

Terminus marks an already admitted health request as `shutting_down` if it
completes after shutdown begins. Known liveness and readiness shutdown shapes
remain sanitized operational `503` responses. New connections are not
guaranteed a response once Nest starts closing the HTTP server; a future
deployment-drain policy will define and test that interval explicitly.

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
