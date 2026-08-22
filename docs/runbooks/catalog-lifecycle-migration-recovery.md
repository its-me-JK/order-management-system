# Catalog lifecycle migration recovery

## Scope

This runbook applies only to
`20260823120000_expand_catalog_lifecycle` on the pinned MySQL 8.4 release. It
exists because MySQL commits each DDL statement independently while Prisma
records the migration only after the complete file succeeds.

Recovery is a controlled database operation, not an application startup task.
Keep every Catalog writer disabled, stop the migration job, preserve its fixed
error and migration record, and take or verify a restorable backup before
changing schema state. Never copy row values into tickets or logs.

## Establish the phase

Run these read-only checks with the DDL-capable migration principal against the
confirmed target database. Record counts and descriptors, not business rows.

```sql
SELECT
    `TABLE_NAME`, `COLUMN_TYPE`, `IS_NULLABLE`, `ORDINAL_POSITION`
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME IN (_utf8mb4'catalog_products', _utf8mb4'catalog_skus')
  AND COLUMN_NAME = _utf8mb4'status_changed_at'
ORDER BY `TABLE_NAME`;

SELECT
    (SELECT COUNT(*) FROM `catalog_products`) AS `product_count`,
    (SELECT COUNT(*) FROM `catalog_products` WHERE `status_changed_at` IS NOT NULL)
        AS `product_backfilled_count`,
    (SELECT COUNT(*) FROM `catalog_skus`) AS `sku_count`,
    (SELECT COUNT(*) FROM `catalog_skus` WHERE `status_changed_at` IS NOT NULL)
        AS `sku_backfilled_count`;

SELECT `TABLE_NAME`, `CONSTRAINT_NAME`, `ENFORCED`
FROM information_schema.TABLE_CONSTRAINTS
WHERE CONSTRAINT_SCHEMA = DATABASE()
  AND TABLE_NAME IN (_utf8mb4'catalog_products', _utf8mb4'catalog_skus')
  AND CONSTRAINT_NAME IN (
      _utf8mb4'ck_catalog_products_status',
      _utf8mb4'ck_catalog_products_lifecycle',
      _utf8mb4'ck_catalog_products_timestamp_order',
      _utf8mb4'ck_catalog_skus_status',
      _utf8mb4'ck_catalog_skus_lifecycle',
      _utf8mb4'ck_catalog_skus_timestamp_order'
  )
ORDER BY `TABLE_NAME`, `CONSTRAINT_NAME`;

SELECT
    `migration_name`, `started_at`, `finished_at`, `rolled_back_at`,
    `applied_steps_count`
FROM `_prisma_migrations`
WHERE `migration_name` =
    _ascii'20260823120000_expand_catalog_lifecycle';
```

The backfill-count query is valid only when both columns exist. If one is
absent, query the existing table alone. Also compare the complete prior or
final schema descriptor with the committed integration test; six familiar
constraint names alone are not enough.

## Decision table

| Observed durable state | Interpretation | Permitted recovery |
| --- | --- | --- |
| Neither column exists | Preflight failed before persistent DDL, or the first DDL did not commit | Correct the reported schema/data prerequisite. After reproducing the preflight on a restored clone, mark the failed migration rolled back and rerun it. |
| Only Product has nullable `status_changed_at`; every value is `NULL`; all old checks remain | Product expansion committed and SKU expansion did not | Use the tested narrow rollback below, prove the exact prior descriptor again, mark the failed migration rolled back, and rerun it. |
| Both columns are nullable and every value is `NULL`; all old checks remain | Both expansion statements committed and the DML transaction did not commit | On a restored clone, drop SKU then Product using the same instant DDL, prove the exact prior descriptor, and only then repeat that rollback on the target. |
| Either nullable column contains a value, or a version floor changed | Backfill may have committed | Do not drop either column or lower a version. Create a new static forward-recovery migration from the original post-backfill validation and only the missing contract statements; test it against a clone of this exact phase. |
| Product checks are final while SKU remains on the old or nullable contract | Product contraction committed and SKU contraction did not | Keep Product unchanged. The forward-recovery migration validates both tables and contains only the missing SKU contract statement. |
| Both columns are non-null and all final checks, indexes, uniqueness, and FK rules match | DDL completed but Prisma may have failed before recording success | Run the full postconditions and integration suite on a clone. Only if every check passes may the migration be marked applied; do not rerun its SQL. |
| Any other combination | State is not an anticipated migration phase | Stop. Restore the tested backup or obtain a separately reviewed reconciliation; do not use `migrate resolve`. |

## Tested narrow rollback

The only directly rehearsed rollback is an entirely empty nullable Product
column after the first additive DDL. The verification suite proves the original
migration fails closed in that state, executes this statement, and then proves
a clean retry reaches the final contract:

```sql
ALTER TABLE `catalog_products`
    DROP COLUMN `status_changed_at`,
    ALGORITHM=INSTANT;
```

For the both-expanded/all-null phase, use the same statement first on
`catalog_skus` and then on `catalog_products`. An empty table still requires
the schema and constraint checks; row count alone is not proof of phase.

After restoring the exact prior contract, record the original failed migration
as rolled back and let the normal migration job apply it again:

```bash
pnpm --filter @oms/database exec prisma migrate resolve \
  --config prisma.config.ts \
  --rolled-back 20260823120000_expand_catalog_lifecycle
pnpm db:migrate:deploy
```

Use `--applied` instead only for the final decision-table state after proving
every final postcondition. `migrate resolve` changes ledger truth; it never
repairs schema or data.

## Exit criteria

- both `status_changed_at` columns are `DATETIME(6) NOT NULL` with no default;
- no lifecycle column is null and every timestamp/version row shape satisfies
  the committed final checks;
- all Product/SKU columns, collations, primary keys, traversal indexes, global
  SKU code uniqueness, name/code checks, and the restrictive ownership FK
  match the committed schema descriptor;
- the Prisma migration has one finished, non-rolled-back record;
- fresh installation, prior-release upgrade, partial-expansion recovery,
  migration replay, Catalog persistence, and HTTP integration tests pass on a
  restored clone;
- Catalog writers remain disabled until the migration job and application
  rollout complete.
