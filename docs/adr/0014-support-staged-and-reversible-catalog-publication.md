# ADR-0014: Support staged and reversible Catalog publication

- **Status:** Accepted
- **Date:** 2026-08-22
- **Partially supersedes:** the lifecycle transition policy in
  [ADR-0013](0013-model-catalog-products-and-skus-separately.md)

## Context

ADR-0013 separated Product and SKU identity and introduced terminal lifecycle
states. Its initial Product state machine allows only
`DRAFT -> ACTIVE -> ARCHIVED`, while SKU allows a never-published draft to be
retired. That leaves an erroneous Product draft permanently stranded. Neither
aggregate can temporarily leave public circulation: an operational, content,
or compliance problem would require an irreversible terminal transition.

Product and SKU remain separate aggregate roots because loading or mutating an
unbounded variation collection would create a hot aggregate. Their lifecycle
rules nevertheless need to support deliberate staging and safe unpublication
without turning Product actions into bulk SKU transactions.

## Decision

Retain the aggregate ownership, identifier, code, visibility, and persistence
decisions in ADR-0013. Replace only its lifecycle transition policy with the
following rules.

Product supports:

- `DRAFT -> ACTIVE`
- `DRAFT -> ARCHIVED`
- `ACTIVE -> SUSPENDED`
- `SUSPENDED -> ACTIVE`
- `ACTIVE -> ARCHIVED`
- `SUSPENDED -> ARCHIVED`

SKU supports:

- `DRAFT -> ACTIVE`
- `DRAFT -> RETIRED`
- `ACTIVE -> SUSPENDED`
- `SUSPENDED -> ACTIVE`
- `ACTIVE -> RETIRED`
- `SUSPENDED -> RETIRED`

`ARCHIVED` and `RETIRED` are terminal. `SUSPENDED` is a reversible
unpublication state for temporary operational, content-quality, safety, or
policy action. Pricing and Inventory still own price, availability, and stock;
Catalog suspension cannot become an inventory or pricing shortcut.

Product and SKU remain separate aggregate roots:

- Product never owns or loads its SKU collection as part of a mutation.
- Public visibility remains a query policy requiring both Product and SKU to
  be `ACTIVE`.
- An `ACTIVE` SKU may sit below a `DRAFT` or `SUSPENDED` Product. This permits
  staged family publication and preserves individually prepared SKUs during a
  temporary Product suspension.
- Product suspension or archival hides its SKUs by changing only the Product.
  It never synchronously suspends or retires an unbounded SKU set.
- Creating, activating, or resuming an SKU under an `ARCHIVED` Product is
  rejected. When this check races with Product archival, the application locks
  the Product before loading or mutating the SKU.
- Global cross-root lock order is Product before SKU.

SKU routes identify a mutation by `skuId`, so they discover its immutable
`productId` with a non-locking, identifier-only projection inside the
transaction. They then lock Product, lock and reload SKU, verify that the
Product identifier still matches, and execute policy. The discovery read
authorizes no decision and does not reverse the lock order.

Lifecycle changes use explicit domain operations and application commands.
There is no generic `setStatus` method or writable `status` request member.
Suspension, archival, and retirement require a bounded, explicitly modeled
audit reason code from the closed set defined by the administrative contract;
the initial contract accepts no free-form note.

`activated_at` records first activation and is never cleared or overwritten.
`archived_at` and `retired_at` record terminal transition time.
`status_changed_at` records the latest lifecycle transition; immutable change
history preserves every earlier transition. Initial Draft establishment counts
as the first status assignment, so `status_changed_at` is non-null and equals
`created_at` at creation. Rename and same-value commands do not change it. A
Product archived directly from Draft has no activation time. An SKU retired
directly from Draft has no activation time.

Lifecycle timestamps retain canonical six-digit UTC precision across the
domain and persistence boundary. Administrative repositories use lossless
string projections and reviewed SQL where Prisma's JavaScript `Date` mapping
would truncate the final three fractional digits.

Names may change while an aggregate is nonterminal. SKU code, Product
ownership, creation time, first activation time, and identifiers are
immutable. A same-value rename is a successful no-op only after its expected
version has been validated; it does not increment the version or emit an
event. Every real mutation increments the aggregate version exactly once.

## Consequences

### Positive

- Catalog operators can temporarily unpublish unsafe or incorrect content
  without destroying the possibility of resuming it.
- Mistaken Product drafts can reach a retained terminal state.
- A Product with many variants can be suspended, resumed, or archived with one
  bounded aggregate mutation.
- Variant families can be prepared before a coordinated Product publication.
- First activation remains historically meaningful across suspend/resume
  cycles.

### Negative

- Each aggregate gains another state and a larger transition test matrix.
- An individually active SKU can be effectively hidden by its Product, so
  callers must use the Catalog visibility policy rather than infer
  orderability from SKU state alone.
- Existing database lifecycle constraints require a reviewed migration before
  write use cases can persist the new states.
- Reversible transitions require immutable history because the current row
  cannot retain every suspension and resumption time.

## Alternatives considered

- **Keep only terminal unpublication:** fewer states, but an ordinary temporary
  incident would permanently destroy the publication path.
- **Move an active item back to Draft:** reuses an existing state but makes
  first-publication and never-published semantics ambiguous.
- **Require every SKU to retire before Product archival:** produces visually
  tidy rows but creates an unbounded, failure-prone administrative workflow.
- **Cascade Product lifecycle changes to every SKU:** appears atomic from the
  caller's perspective but turns a Product command into a large multi-root
  transaction and contention hotspot.
- **Make Product own all SKUs:** enforces lifecycle in one aggregate but
  reverses the scalability decision in ADR-0013.

## Revisit when

Revisit the state names or transitions when a real moderation workflow needs
separate merchant, compliance, and safety holds; when scheduled publication is
approved; or when measured Product variant counts make even the Product-first
locking check contentious. Preserve bounded Product mutations and effective
visibility across both aggregate roots.
