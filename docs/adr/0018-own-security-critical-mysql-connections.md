# ADR-0018: Own connections for security-critical MySQL transactions

- **Status:** Accepted
- **Date:** 2026-08-23
- **Refines:** the transaction adaptation and runtime-lifecycle decisions in
  [ADR-0006](0006-persistence-boundaries.md) and
  [ADR-0012](0012-expose-prisma-only-as-an-infrastructure-capability.md)

## Context

Identity refresh rotates a credential and may revoke a complete session family
when reuse is detected. A successor credential may be disclosed only after the
database has acknowledged `COMMIT`. If a deadline, network failure, or shutdown
occurs around settlement, the application must distinguish a proven rollback
from an indeterminate commit and must prevent the suspect transport or its
capacity slot from being reused prematurely.

Prisma remains the preferred schema, migration, mapping, and ordinary query
tool. Its interactive transaction API deliberately hides the acquired driver
connection. In the pinned Prisma 7.9.1 implementation, cancellation and
rollback are owned below the application callback, rollback failure is not a
stable application outcome, and the caller cannot destroy exactly the socket
whose transaction stalled. `Promise.race` bounds only the caller; it does not
cancel the database operation or prove settlement.

The pinned MariaDB adapter exposes its underlying pool on its concrete return
type, but sharing that pool would require replacing adapter disposal and
reconnect behavior with a custom facade. That hook is absent from Prisma's
general driver-adapter contract. Making credential safety depend on this
package-specific lifecycle behavior would create an upgrade-sensitive security
boundary.

The pinned MariaDB 3.4.5 pool cannot close this gap. With `minimumIdle: 0`, its
size predicate never creates a connection for queued work. With a positive
minimum, it owns eager and replacement connection attempts that its public
`Pool.end()` does not observe or await. A live black-hole TCP proof showed
`end()` resolving while the initial transport remained open until the connect
timeout. `PoolConnection.destroy()` is also a void operation and may open an
additional unbudgeted connection to issue `KILL` while a command is in flight.
Neither behavior is an acceptable terminal lifecycle or capacity boundary.

Creating any independent direct path without adjusting the existing limit
would also be unsafe operationally: a configured limit of five could silently
become ten. The repository needs one lifecycle and provenance authority so a
transaction executor cannot accidentally combine a Prisma client from one
runtime with a direct connection from another.

## Decision

Keep one MySQL database and one generated Prisma client per process runtime.
Add a narrowly reserved, bounded allocator of one-use MariaDB
Connector/Node.js connections for allow-listed transactions that require exact
connection ownership, initially Identity refresh. Do not use the connector's
pool for this boundary.

### Ownership and visibility

- `DatabaseRuntime` owns both the Prisma client/pool and the direct-connection
  allocator. It is the only terminal lifecycle authority for either resource.
- The allocator is created lazily and has no idle connections. A runtime that
  never composes an exact-connection command does not open a socket.
- Runtime identity, not matching connection configuration, establishes
  provenance. Package-private maps associate one exact Prisma client and one
  exact direct-connection lease owner with the same runtime object.
- `@oms/database` and `@oms/database/prisma` do not export the allocator, driver
  connections, checkout leases, query methods, or settlement methods.
  A future `@oms/database/mysql-transaction` entrypoint may expose only a
  closed transaction executor, never an allocator or connection.
- Only `@oms/database` may import `mariadb`. Vendor values and errors cannot
  cross into application or domain contracts.
- The direct dependency is pinned exactly. Depending on Prisma's transitive
  copy would leave compatibility and security updates outside this package's
  declared contract.

The database package owns acquisition, deadlines, operation tracking,
settlement classification, and connection quarantine. Business-module
infrastructure continues to own reviewed SQL, projections, and database-error
mapping for its tables. Application code receives only its module-owned Unit
of Work and opaque scope; it never receives a generic query callback.

Prisma operations must never run inside, or be represented as part of, a
direct-driver transaction. A connection-owning Identity Unit of Work will use
direct-driver scoped stores for every read and write in that transaction.
Ordinary discovery, authority reads, and unrelated persistence remain on
Prisma.

### One aggregate connection budget

`DATABASE_CONNECTION_LIMIT` is the total application connection budget per
runtime, not a per-resource value.
`DATABASE_TRANSACTION_CONNECTION_LIMIT` reserves a strict subset as the
maximum number of non-settled direct transport slots; Prisma receives the
remainder.

```text
2 <= DATABASE_CONNECTION_LIMIT <= 50
1 <= DATABASE_TRANSACTION_CONNECTION_LIMIT < DATABASE_CONNECTION_LIMIT

Prisma limit = total limit - direct transaction limit
```

The initial default is five total: three Prisma pool connections and at most
two direct transaction connections. Queued direct acquisitions own no socket.
Connecting, active, and physically closing registrations each consume one
reserved slot. The wait queue admits at most one requester per reserved slot;
expired requesters are removed immediately, so stalled transactions cannot
create an unbounded heap-retention path. Operators must satisfy:

```text
application replicas * DATABASE_CONNECTION_LIMIT
+ migration and administrative reserve
<= database max_connections
```

The reserve is explicit because direct transactions must not be starved by
ordinary reads, while ordinary readiness and Catalog reads must not be starved
by a refresh storm. Changing the split requires load and contention evidence;
it is not a feature-level tuning knob.

### Allocator and shutdown contract

- The allocator reserves capacity before calling `mariadb.createConnection()`.
  Each attempt supplies a supported `stream` factory and owns the exact
  `net.Socket` before the connector promise is returned. Server redirects are
  disabled so one registration cannot create an unowned transport.
- Each direct connection is used once. There is no idle reuse, pool reset, or
  release-to-pool path. Physical `socket.closed` proof, not a driver method
  returning, releases reserved capacity.
- Every query issued through the managed connection is registered before it is
  returned. A registration remains capacity-consuming until its exact socket
  is physically closed and all registered operations have fulfilled or
  rejected. A fixed, allocator-owned error is observed at the connector event
  boundary and is never logged or exposed as a public application failure.
- Checkout is represented by one opaque, runtime-authentic, one-shot lease.
  Forged, copied, replayed, foreign-runtime, or settled leases do not touch a
  connection. A lease remains authentic while release is pending so
  its caller-owned deadline can quarantine the exact transport.
- Shutdown changes the owner to closing synchronously, prevents new checkout,
  rejects queued work, closes connecting sockets, observes every connection
  promise, permits only a bounded grace period for active internal work, and
  closes remaining exact sockets. It resolves only after those sockets report
  physically closed and registered driver operations settle.
- A connection established after shutdown won its race is quarantined and
  never delivered. A stalled command whose caller-owned deadline expires
  closes the exact owned socket and withholds its slot until closure and
  operation-settlement proof.
- Quarantine never calls connector `Connection.destroy()`: that method may
  create an unbudgeted helper connection while work is pending. It closes the
  allocator-owned stream directly with a fixed sanitized error so the
  connector rejects in-flight work.
- Release does not call connector `Connection.end()`. That method moves the
  driver to `CLOSING` before `COM_QUIT` settles, after which its socket-error
  handler ignores an exact-stream quarantine and can retain the pending end or
  command. Once the future executor has settled `COMMIT` or `ROLLBACK`, release
  terminates the one-use stream directly and waits for the same closure and
  operation barriers.
- Runtime shutdown attempts both Prisma disconnection and allocator closure
  even if either fails, and exposes only a fixed cause-free lifecycle error.
- Terminal proof is deliberately fail-closed. If the pinned connector ever
  leaves a connection or query promise pending after the exact socket is
  physically closed, shutdown does not report success or return that capacity.
  The deployment process-termination deadline is the final backstop; this path
  requires a closed-cardinality operational signal before production use.
- Driver query, network, warning, parameter, packet, and debug logging are
  disabled at the connection boundary. Bound credential digests and provider
  errors must not reach stdout, structured logs, or public failures.
- Multiple statements, local infile, compatibility placeholder expansion,
  numeric coercion, and prepared-statement caching are disabled. Driver query
  and socket timeouts remain unset because they cannot establish transaction
  settlement.

The allocator lifecycle foundation does not itself authorize a transaction.
The future executor must additionally establish `READ COMMITTED`, assert UTC,
obtain `CURRENT_TIMESTAMP(6)` on the same connection, serialize tracked
operations, own one absolute deadline, and quarantine a connection whose work
cannot be drained safely.

Before that executor can receive public credential traffic, executable gates
must cover `verify-identity` TLS establishment and quarantine through the
connector's upgraded stream, plus expiry and shutdown during connector
initialization before a connection is published.

Only an acknowledged `COMMIT` can promote pending evidence to credential
delivery authority. A pre-commit failure is `not-committed` only after a
confirmed rollback or independent proof that the server session ended. A
failure after the commit request, a failed drain, or any unproved settlement is
`indeterminate`; it is never retried internally and never discloses a successor
credential.

## Consequences

### Positive

- Security-critical transactions can eventually cancel and quarantine the
  exact connection they own instead of timing out only the JavaScript caller.
- Prisma remains the productive default for most persistence and retains one
  client per runtime.
- One total budget prevents accidental connection multiplication and reserves
  capacity for both ordinary reads and critical transactions.
- Same-runtime provenance and one shutdown owner make resource lineage
  explicit and testable.
- No second database, provider, account, or paid service is introduced; both
  persistence paths use the same MySQL endpoint and least-privilege DML
  principal.

### Negative

- Each process now has one Prisma pool and a second persistence path to
  operate, measure, fault-test, and upgrade.
- Every critical command pays a new TCP, TLS when enabled, and authentication
  handshake. This favors provable lifecycle ownership over initial latency and
  database CPU efficiency.
- One-use release deliberately omits graceful `COM_QUIT`. The executor must
  settle the transaction first; then exact transport teardown gives a stronger
  terminal driver contract at the cost of an abrupt server-session close. This
  can increase MySQL `Aborted_clients` and server-log noise and must be measured
  with a closed-cardinality operational signal.
- Poor reserve sizing can still reduce ordinary Prisma capacity. The allocator
  itself consumes no idle direct connections.
- Connection-owning stores require reviewed SQL and explicit mapping that
  Prisma would otherwise generate.
- The executor must establish transaction isolation and UTC on every new
  connection.
- Commit ambiguity cannot be designed away. The application needs completion
  evidence and a safe client recovery contract rather than automatic retry.

## Alternatives considered

- **Prisma interactive transactions:** preserve one data path, but do not give
  the caller exact cancellation, quarantine, or stable rollback/commit proof.
- **Share Prisma's adapter pool through `underlyingDriver()`:** saves
  connections, but requires custom disposal/reconnect ownership around a
  package-specific hook outside the general adapter contract.
- **Maintain a custom or forked Prisma adapter:** could make pool ownership
  explicit, but creates disproportionate security and upgrade burden for one
  narrow transaction family.
- **Use MariaDB's second pool:** provides reuse, but its eager/replacement
  connection attempts, public shutdown, and in-flight `destroy()` behavior do
  not form a provable socket or capacity lifecycle in pinned 3.4.5.
- **Create a full second pool limit:** is simple, but silently doubles the
  operator's intended connection budget.
- **Build a reusable custom direct pool now:** could retain exact stream
  ownership, but needs reset deadlines, idle validation, generation
  quarantine, and substantially more fault proof before load evidence justifies
  that complexity.
- **Disconnect the whole Prisma runtime on timeout:** is coarse, disrupts
  unrelated work, and still cannot prove the exact transaction outcome.
- **Use a stored procedure or grant `KILL QUERY`:** moves orchestration or adds
  privileges without eliminating commit ambiguity; query kill may also require
  another connection.
- **Replace Prisma everywhere:** gives uniform direct-driver control but spends
  substantial complexity where generated, ordinary persistence remains safe
  and useful.
- **Use `mysql2` for the direct path:** adds a second driver family when the
  already-pinned Prisma path is tested with MariaDB Connector/Node.js.

## Revisit when

Revisit pool sharing if Prisma publishes and supports injection and lifecycle
ownership of an existing pool together with exact connection checkout. Revisit
one-use allocation after measured handshake cost and refresh throughput justify
a custom reusable allocator with equally strong socket, reset, deadline, and
capacity proofs. Revisit the split after measured saturation and database
`max_connections` evidence. Revisit the direct path if the Identity module is
extracted, but preserve exact connection ownership, commit-gated disclosure,
and indeterminate settlement in any service boundary.
