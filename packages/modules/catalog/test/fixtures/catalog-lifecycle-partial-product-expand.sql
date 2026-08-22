INSERT INTO `catalog_products` (
    `id`, `name`, `status`, `version`, `created_at`, `updated_at`, `activated_at`, `archived_at`
) VALUES (
    X'019D2D0A000570008000000000000001',
    _utf8mb4'Partial expansion fixture',
    _ascii'DRAFT',
    1,
    '2026-01-01 00:00:00.000001',
    '2026-01-01 00:00:00.000001',
    NULL,
    NULL
);

-- Simulate a failure after Product expansion committed but before SKU
-- expansion. The production migration must fail closed without backfilling.
ALTER TABLE `catalog_products`
    ADD COLUMN `status_changed_at` DATETIME(6) NULL AFTER `updated_at`,
    ALGORITHM=INSTANT;
