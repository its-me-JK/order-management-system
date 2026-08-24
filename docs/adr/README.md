# Architecture decision records

Only decisions that constrain the current system are retained here. Implementation detail belongs in living architecture documents, and superseded experiments are removed rather than presented as active design.

| ADR | Decision |
| --- | --- |
| [0001](0001-modular-monolith.md) | Modular monolith with separate API, worker, and static web runtimes |
| [0002](0002-runtime-data-boundaries.md) | MySQL source of truth; Redis and RabbitMQ have narrow operational roles |
| [0003](0003-order-inventory-consistency.md) | Serializable reservation and durable idempotent order creation |
| [0004](0004-transactional-outbox.md) | Transactional outbox with at-least-once, idempotent consumers |
| [0005](0005-zero-cost-showcase.md) | Same-origin static showcase optimized for zero hosting cost |

An ADR records context, decision, consequences, and alternatives. Create a new ADR when changing one of these constraints; do not silently rewrite history after the first public release.
