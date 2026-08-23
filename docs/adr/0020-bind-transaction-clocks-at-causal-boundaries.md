# ADR-0020: Bind transaction clocks at causal boundaries

- **Status:** Accepted
- **Date:** 2026-08-24
- **Refines:** the same-connection writer-time requirement accepted by
  [ADR-0018](0018-own-security-critical-mysql-connections.md)
- **Partially supersedes:** the `writerTime` program-context field, combined
  clock/session assertion, and active-phase writer-time failure clauses in
  [ADR-0019](0019-seal-exact-connection-mysql-transaction-programs.md)

## Context

ADR-0019 gave every fixed transaction program one timestamp read immediately
after `START TRANSACTION`. That placement is safe only when no business lock can
delay the decision that consumes the timestamp.

Identity refresh deliberately locks Account, SessionFamily, and the presented
RefreshCredential before deciding whether to rotate or close a family for
reuse. Under contention, a transaction can capture the generic timestamp and
then wait while another transaction commits a later family rotation. When the
waiter finally reloads that committed state, its earlier timestamp violates the
aggregate chronology instead of committing the required reuse closure. A
generic pre-lock clock therefore becomes stale write authority.

The infrastructure executor still must attest the exact connection's UTC and
`READ COMMITTED` session characteristics after `BEGIN`. Session correctness and
business-time placement are different decisions and should not be coupled.

## Decision

The generic MySQL transaction program context exposes no writer timestamp. The
executor performs a post-`BEGIN` characteristics query that attests exact UTC
and `READ-COMMITTED` state but does not mint business clock authority.

Every timestamped program must declare an opaque, static, allowlisted clock
statement and execute it at its reviewed causal boundary. For Identity refresh:

1. acquire the Account, SessionFamily, and presented RefreshCredential locks in
   the global order;
2. after the final awaited lock, read exactly one `UTC_TIMESTAMP(6)` value from
   the MySQL writer;
3. validate one canonical six-fraction UTC instant and bind it privately to the
   authentic locked-load workflow;
4. use that immutable value for the decision, derived expiries, conditional
   writes, and SecurityEvent time; and
5. never clamp it to persisted state or re-read time later in the transaction.

If a lock stage returns not-found, its attempted statement is that execution's
last lock boundary. The same clock statement runs next so locked-load
completion can settle through one invariant path without granting DML or
credential-delivery authority.

`UTC_TIMESTAMP(6)` makes the selected instant independent of a connector's
session timezone. The direct executor continues to set and attest UTC as a
separate defense and because other statement projections rely on the session
contract. The Prisma reference loader uses the same UTC clock expression even
though it does not own session establishment.

The clock token remains subject to the executor's static-statement identity,
server-prepared dispatch, one-operation rule, deadline, failure sanitization,
and settlement semantics. A business caller cannot supply SQL or choose when
the clock is read.

## Consequences

### Positive

- A lock waiter cannot compare newly committed aggregate state against a
  timestamp captured before it entered the lock queue.
- The generic executor no longer grants ambient time authority to programs that
  do not need it.
- Clock placement is visible in each program's reviewed statement allowlist and
  can differ when another aggregate has a different causal boundary.
- Explicit UTC selection protects the reference Prisma path from a non-UTC
  session default.

### Negative

- A timestamped workflow pays one additional prepared database round trip after
  its required locks.
- The internal transaction contract is source-incompatible with consumers of
  ADR-0019's exported `writerTime` field; every repository consumer must migrate
  in the same commit.
- Each timestamped program now owns a clock decoder and exact ordering tests,
  adding ceremony to its infrastructure adapter.
- Correct clock placement does not remove deadlocks, lock timeouts, transaction
  deadlines, or commit ambiguity.

## Alternatives considered

- **Keep the generic post-`BEGIN` clock:** fewer statements, but it preserves the
  contention race because `BEGIN` is not the refresh decision's causal boundary.
- **Clamp time to the persisted aggregate timestamp:** avoids a chronology
  exception by fabricating authority from stored state and can silently distort
  expiry or audit semantics.
- **Read time in every mutation statement:** removes the extra clock statement
  but allows one transaction to use different instants across its decision,
  graph writes, and event.
- **Include time in the final locking SELECT:** MySQL can establish a statement
  timestamp before a blocking row lock is granted, so placement inside that
  statement does not prove a post-lock instant.
- **Use the application process clock:** loses writer authority, database
  precision, and consistency across API replicas.

## Interview discussion prompts

- Why is transaction start not always the correct causal time for a
  pessimistically locked workflow?
- Why is clamping an earlier timestamp to `lastRotatedAt` weaker than reading a
  fresh writer timestamp after lock acquisition?
- Why keep UTC session attestation when the clock statement itself uses
  `UTC_TIMESTAMP(6)`?
- Why does the not-found path still bind a post-lock clock even though it emits
  no DML?

## Revisit when

Revisit the extra round trip only if the database exposes a proven
post-lock-evaluation primitive or the complete decision and mutation can move
into one reviewed stored operation without weakening Clean Architecture,
static SQL review, or commit-ambiguity handling. Do not restore a generic
pre-lock timestamp merely to reduce latency.
