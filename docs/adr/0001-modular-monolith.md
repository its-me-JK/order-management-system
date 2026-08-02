# ADR-0001: Start with a modular monolith

- **Status:** Accepted
- **Date:** 2026-08-02

## Context

Orders, inventory, payments, and fulfillment have distinct business
responsibilities, but their detailed invariants and operating characteristics
will evolve during the first production-quality implementation. Deploying them
as independent services immediately would introduce network failure,
distributed tracing, contract evolution, duplicated infrastructure, and
cross-service consistency problems before those costs provide measurable
value.

The project must nevertheless avoid becoming a tightly coupled monolith that
cannot be separated later.

## Decision

Build the backend as a modular monolith with explicit business-module
boundaries and Clean Architecture inside each module.

Modules own their application interface and persistence. They may collaborate
synchronously through application ports or asynchronously through versioned
integration events. They may not access another module's repository or tables
directly.

The initial modules are Identity and Access, Customers, Catalog, Pricing,
Inventory, Orders, Payments, Fulfillment, Notifications, Integrations, and
Audit.

Notification and Payment remain extraction candidates, not pre-approved
microservices.

## Consequences

### Positive

- Strong local transactions protect early order and inventory invariants.
- Local development, debugging, testing, and deployment remain manageable.
- Business boundaries can mature without versioning every internal call.
- A single team can change coordinated workflows safely.

### Negative

- Modules share a deployment cadence and physical database at first.
- Boundary discipline must be enforced through reviews and automated import
  tests rather than network isolation.
- A memory or CPU problem can affect both business capabilities in the same
  runtime unless API and worker isolation mitigates it.

## Alternatives considered

- **Microservices from the beginning:** rejected because operational and
  consistency costs precede demonstrated scaling or ownership needs.
- **Traditional layered monolith:** rejected because global controller,
  service, and repository layers encourage cross-domain coupling.
- **Serverless functions per operation:** rejected because workflow state,
  local transactions, cold-start behavior, and operational fragmentation are
  poor initial trade-offs for this domain.

## Revisit when

Reconsider a module's deployment boundary when independent ownership, scaling,
compliance isolation, release cadence, or failure containment provides
measurable value and the module already has isolated contracts and data.
