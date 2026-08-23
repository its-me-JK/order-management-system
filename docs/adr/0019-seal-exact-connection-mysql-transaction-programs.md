# ADR-0019: Seal exact-connection MySQL transaction programs

- **Status:** Accepted
- **Date:** 2026-08-23
- **Refines:** the direct-connection execution boundary accepted by
  [ADR-0018](0018-own-security-critical-mysql-connections.md)

## Context

ADR-0018 established a runtime-owned, bounded allocator of one-use MariaDB
Connector/Node.js connections for security-critical MySQL transactions. That
allocator proves connection provenance, exact-stream quarantine, capacity
ownership, and terminal runtime shutdown. It deliberately does not expose a
supported transaction API.

Identity refresh cannot safely deep-import the allocator or its lease owner.
The current managed connection also accepts only a SQL string, permits more
than one operation, has no transaction deadline, and has no settlement state.
It is therefore insufficient for bound credential digests, deterministic
operation sequencing, or commit-ambiguity classification.

A generic `execute(callback)` API would close the resource gap but weaken the
application boundary. A caller could supply a different callback on each
execution, return a structurally forged commit directive, issue transaction
control as ordinary SQL, or let a driver error carrying SQL and bound values
escape into a business module. The executor needs a narrower supported seam
before Identity can implement its concrete refresh Unit of Work. It also needs
to distinguish returning a deadline-driven `indeterminate` outcome from the
later settlement of the actual program Promise. Connection quarantine alone
cannot tell Identity when it is safe to close a still-running command and
retire its attempt.

## Decision

Add an infrastructure-only `@oms/database/mysql-transaction` entrypoint. It
exports a closed executor factory and closed contract types. It never exports
the allocator, lease, driver connection, socket, raw query operation, or a
`BEGIN`, `COMMIT`, `ROLLBACK`, release, destroy, retry, or cancellation method.

### Fixed program and runtime provenance

The factory accepts one authentic `DatabaseRuntime`, one infrastructure
program, and one validated transaction timeout from 1 through 10 seconds. It
privately recovers the direct-connection owner registered to that exact
production runtime and captures the program function and optional
`observeProgramSettlement(input)` function once. Program, observer, and decoder
functions are invoked receiver-free, so later mutation of their definition
objects cannot change `this`-based behavior. The returned executor is frozen,
has no enumerable resource field, and has one operation:

```text
execute(input) -> transaction outcome
```

Runtime and lease authority registries invoke captured `WeakMap` and `Set`
intrinsics. Both the runtime and executor implementations require private
construction capabilities and an exact `new.target`; their constructors and
prototypes are frozen before an instance can escape. Recovering a constructor,
mutating a collection prototype, or supplying a foreign runtime therefore
cannot register or obtain direct-connection authority.

`execute` accepts no callback. A business-module infrastructure adapter fixes
its reviewed program during construction and may vary only the typed input to
each execution. Application and domain code cannot import this entrypoint and
continue to depend on module-owned ports such as
`IdentitySessionRefreshUnitOfWork`.

The program receives one frozen, execution-authentic session. It exposes only:

- the same-connection, lossless UTC `writerTime`;
- `executeStatement(statement, parameters)` for an opaque registered
  statement;
- `requestCommit(result)` and `requestRollback(result)`, which mint a dormant
  directive but do not settle the database transaction.

The program also declares frozen allowlists of every statement token and every
closed failure string it may return. Its unavailable and execution-defect
failures, each duplicate-key mapping, and each requested rollback must be a
member. The first directive is bound by runtime identity to that exact
execution. A cast, structural object, clone, Proxy, foreign-execution directive,
replay, or second directive cannot select transaction settlement. The executor
seals the session as soon as the program settles and authenticates the returned
directive without reading its properties.

The optional settlement observer is a synchronous notification boundary, not
a completion callback. Before entering the deadline race, the executor attaches
it to the actual, fixed program Promise. On either fulfilment or rejection, the
executor first seals statement authority, drains the exact tracked statement
operation if the program floated one, and then invokes the captured observer
exactly once with only the original program input. It still invokes the observer
if the deadline already caused `execute` to return `{ kind: "indeterminate" }`.

The observer receives no program result, thrown value, transaction outcome,
connection, statement context, SQL, directive, or commit/rollback authority.
It cannot select settlement or authenticate database evidence. A thrown value
or non-void runtime return never escapes this infrastructure boundary and
poisons an outcome that has not yet settled. The TypeScript contract requires
the literal `undefined` return type, so an accidental async implementation is
rejected at compile time. At runtime, captured intrinsic handlers best-effort
contain either settlement of an ordinary, unmodified native Promise without
reading a caller-controlled `then`; arbitrary thenables, Promise subclasses,
and Promise instances with modified constructor/species behavior are never
claimed safe. The observer is fixed trusted infrastructure code and must not
spawn rejected work by side effect. After an outer outcome has returned,
observer behavior cannot alter it.

The notification proves only that the top-level program Promise and the one
executor-tracked statement operation have settled. It cannot discover a
detached non-SQL continuation created by faulty program code. Reviewed programs
using this hook must therefore start no detached work; the future Identity
program will await every package-owned operation.

### Statements and bound values

Statements are empty, frozen, runtime-authentic tokens defined from one static,
reviewed SQL string. Definition accepts only one `SELECT`, `INSERT`, `UPDATE`,
or `DELETE` statement. Transaction control, DDL, `CALL`, session mutation,
multiple statements, comments, mode-dependent double-quoted or backslash
escaping, unmatched quotes, and unmatched positional placeholders are not part
of this boundary. A small SQL lexer counts `?` only outside single-quoted
literals and backtick-quoted identifiers. The SQL string is held in a private
registry and is not an enumerable field of the token.

Registered statements use the connector's server-prepared `execute` path;
transaction and session controls use its unparameterized `query` path. Bound
values are never rendered into a `COM_QUERY` SQL string by the client-side
escape formatter. Prepared-statement caching remains disabled because every
owned connection is one-use.

Each execution accepts only `null`, bounded strings, safe integers, `bigint`,
booleans, and byte arrays with an aggregate limit of one MiB as positional
values. It validates the exact parameter count synchronously before starting
the driver operation. Byte arrays are copied before the first await.
Executor-owned copies are overwritten only after the actual driver Promise
fulfills or rejects; the executor never mutates caller-owned memory and never
wipes a copy while a floated driver operation may still read it.

At most one statement operation may be outstanding. The operation registration
is acquired synchronously before calling the driver and is released only when
that exact driver Promise and its decoder settle. A concurrent, floated,
foreign-statement, or pre-settlement post-seal call poisons the execution and
can never lead to `COMMIT`; later escaped calls remain sealed and cannot reach
the driver. Authority-critical Set, Map, and WeakMap operations use captured
intrinsics rather than mutable prototype dispatch.

### Statement failures

Raw MariaDB driver errors never cross the supported entrypoint. A rejected
statement is converted into one fixed, cause-free internal failure and
permanently poisons the program session. The database package may inspect own
`errno`, `code`, `sqlState`, and the bounded server-text field `sqlMessage`. It
never inspects the connector's generic `message`, `sql`, or parameter fields
because those can contain statement details. Only an exact duplicate-key
identity plus an exact constraint name registered on that exact statement can
select one of the program's allowlisted
failures. Every unknown constraint, foreign key, deadlock, lock timeout,
connection error, rejected decoder, or decoder failure selects the program's
allowlisted unavailable failure. A total statement decoder may instead settle
normally with a module-owned `malformed` evidence value when a fulfilled driver
envelope violates that statement's pinned structural contract. The fixed
program must treat that evidence as its execution defect and request rollback;
it is not a provider rejection and cannot be reclassified as a business
conflict.

The executor then discards the vendor value without logging, coercing,
attaching it as a cause, or retaining it. The fixed statement definition owns
the only result decoder that sees the raw driver result. SQL, provider values,
and constraint names are never fields of an outcome. A vendor number or
constraint name alone never decides a business outcome.

### Session establishment and deadline

The allocator's existing acquisition timeout remains the independent checkout
bound. Immediately after checkout and before session setup, every execution
starts one configured absolute transaction deadline. Identity's accepted
default is five seconds and the supported range is one through ten seconds.
The deadline value is captured and validated when the executor is constructed;
it is never supplied per execution.

On the acquired one-use connection, the executor alone performs this order:

1. set the session time zone to UTC;
2. set the next transaction isolation level to `READ COMMITTED`;
3. request `START TRANSACTION`;
4. read `CURRENT_TIMESTAMP(6)` and assert UTC plus `READ-COMMITTED` on that same
   connection;
5. invoke the fixed program once;
6. attach one settlement continuation to the actual program Promise before
   observing it against the deadline;
7. follow exactly one deadline branch:
   - when program settlement wins, ensure the statement session is sealed,
     drain the exact outstanding statement operation if any, invoke the optional
     observer once, and request `COMMIT` or `ROLLBACK` once;
   - when the deadline wins, seal and quarantine the session, return
     `indeterminate`, and let the already-attached continuation invoke the
     observer only after the actual program Promise and tracked statement
     operation later settle;
8. retire the one-use transport on the settlement path or preserve its
   quarantine on the deadline path; the observer controls neither lifecycle.

The absolute deadline covers establishment, program work, settlement, and
retirement after checkout. A captured monotonic expiry instant is checked
before statement dispatch and whenever a driver or program Promise settles;
the timer callback is only the wake-up mechanism. Event-loop starvation cannot
extend the transaction or authorize a late `COMMIT`. Expiry synchronously seals
the program session and quarantines the exact lease. A caller-side
`Promise.race` without quarantine is not cancellation and is forbidden. If a
raw driver Promise does not settle, the allocator withholds its capacity slot;
runtime shutdown and the deployment termination deadline remain the terminal
backstops.

The observer does not extend the caller-visible deadline. If that deadline wins
first, `execute` returns the fixed indeterminate outcome while the already
attached observer remains pending on the actual program Promise and, if
present, its exact tracked statement operation. A future Identity Unit of Work
will combine this notification with its independently known database outcome
through a two-sided rendezvous. If setup fails before the fixed program is
invoked, a module-owned synchronous start marker instead proves that no program
cleanup can race. Exact committed evidence can be promoted only after both
sides are ready, while proven non-commit or indeterminate settlement revokes
the exact evidence only after program settlement or proven non-start. Neither
side grants the other SQL, connection, outcome-selection, or
credential-delivery authority.

### Settlement outcomes

The exact frozen infrastructure outcome union is:

```text
{ kind: "committed", result }
{ kind: "not-committed", failure }
{ kind: "indeterminate" }
```

`failure` is one primitive member of the fixed program allowlist. Setup and
provider inability use the program's unavailable member; invalid orchestration
uses its execution-defect member; and an expected rollback carries only its
allowlisted reason. Commit and rollback wrappers are prepared when the
authentic directive or internal failure is registered, before database
settlement. Neither wrapper is Identity credential-delivery authority.

The executor uses these absorbing phases:

- **pre-begin:** `START TRANSACTION` was never issued. Failure is proven
  non-commit.
- **begin-requested:** `START TRANSACTION` was issued but not acknowledged.
  Acknowledged rollback or a completed exact session-closure barrier is
  required to prove non-commit; otherwise the outcome is indeterminate.
- **active:** `START TRANSACTION` was acknowledged. Program rollback,
  writer-time/assertion failure, or execution failure first seals and drains
  the session, then requests rollback once.
- **rollback-requested:** no other control statement is legal. Rollback
  acknowledgement or completed exact session closure proves non-commit; an
  unresolved barrier is indeterminate.
- **commit-requested:** any rejection, timeout, or disconnect is
  indeterminate. The executor never sends rollback and never retries after a
  commit request. Only acknowledgement changes the phase to committed.
- **committed** and **rolled-back:** settlement is proven and cannot be
  downgraded by later transport-retirement failure. The exact connection is
  still quarantined when retirement cannot be observed before the deadline.

An invalid directive, thrown program value, hostile thenable, concurrent or
floated operation, or escaped-session use is an execution failure. The caught
value is never inspected or retained. It becomes `not-committed` with the
program's execution-defect failure only after rollback or session-end proof;
otherwise the outcome is indeterminate.

The executor never retries. In particular, it never retries a deadlock,
credential collision, connection failure, or ambiguous commit.

## Consequences

### Positive

- Identity can compose reviewed direct-driver stores without importing the
  MariaDB driver or the allocator's private lease lifecycle.
- Transaction control, deadline, operation drain, and outcome classification
  have one database-owned implementation.
- Static statement tokens make accidental transaction-control SQL and
  statement-identity confusion reviewable.
- The optional settlement observer lets a module eventually retire application
  capabilities after a deadline without weakening the executor's caller-visible
  timeout or granting the module transaction authority.
- Bound values use server-prepared execution rather than client-side SQL
  rendering, and temporary binary copies have a bounded lifetime tied to the
  actual driver operation.
- Commit ambiguity remains explicit rather than being converted into an unsafe
  retry or credential disclosure.

### Negative

- The database package gains a second supported infrastructure entrypoint and
  a non-trivial transaction state machine.
- Static statement registration and opaque failure capabilities add ceremony
  compared with exposing `connection.query` directly.
- A five-second deadline can quarantine capacity under database contention;
  the reserved connection budget and closed-cardinality metrics must make that
  visible before public traffic.
- Exact connection ownership still cannot eliminate commit ambiguity or a
  connector that never settles after socket closure.
- The observer also cannot make a program Promise settle. A permanently
  unresolved program keeps its connection quarantined and its module-owned
  lifecycle rendezvous incomplete until a terminal backstop intervenes.

## Alternatives considered

- **Deep-import the lease owner into Identity:** shortest implementation, but
  bypasses package exports, runtime abstraction, and the accepted ownership
  boundary.
- **Expose a raw connection or query callback:** flexible, but permits
  transaction control, concurrent work, driver-error leakage, and arbitrary
  callback results.
- **Accept SQL strings directly on every execution:** smaller, but makes
  transaction-control review and exact statement-based constraint
  classification weaker.
- **Use Prisma interactive transactions:** does not provide exact connection
  cancellation, quarantine, or stable commit/rollback ambiguity evidence.
- **Automatically retry deadlocks or connection failures:** can repeat a
  security decision and is unsafe after an ambiguous commit.
- **Return vendor errors for module-side classification:** couples modules to
  the driver and can retain SQL, parameters, duplicate values, or provider
  internals.
- **Pass the program result, error, or transaction outcome to a cleanup
  callback:** would make a notification hook a second settlement or data
  boundary. The observer needs only the original input needed to identify its
  module-owned lifecycle registration.

## Interview discussion prompts

- Why is a rejected or timed-out `COMMIT` indeterminate even when a subsequent
  rollback appears to succeed?
- Why does a timer callback alone not enforce an absolute transaction deadline
  under event-loop starvation?
- What security and correctness properties are lost when a connector renders
  values into `COM_QUERY` instead of using server-prepared execution?
- Why does the executor capture one fixed program instead of accepting an
  arbitrary callback on each call?
- When can exact socket-closure plus operation-drain evidence substitute for a
  rollback acknowledgement, and why is calling `destroy()` alone insufficient?
- Why are duplicate failures classified by statement and exact named
  constraint rather than by vendor number alone?
- Why must program settlement and database settlement meet through a two-sided
  rendezvous instead of letting the observer promote commit evidence?

## Revisit when

Revisit the accepted deadline range only after transaction latency and
quarantine metrics justify a policy change. Revisit static statements if a
reviewed bulk operation needs a bounded statement family, but do not add
arbitrary SQL or transaction control. Revisit the direct path if the connector
exposes a stable cancel-and-drain primitive or Prisma exposes exact checked-out
connection ownership with equivalent settlement evidence.
