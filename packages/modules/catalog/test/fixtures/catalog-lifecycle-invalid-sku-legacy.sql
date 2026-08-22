INSERT INTO `catalog_products` (
    `id`, `name`, `status`, `version`, `created_at`, `updated_at`, `activated_at`, `archived_at`
) VALUES (
    X'019D2D0A000370008000000000000001',
    _utf8mb4'Valid parent',
    _ascii'DRAFT',
    1,
    '2026-01-01 00:00:00.000001',
    '2026-01-01 00:00:00.000001',
    NULL,
    NULL
);

-- This row is valid under the prior contract, but its terminal transition time
-- cannot be recovered: the legacy update timestamp occurred after retirement.
INSERT INTO `catalog_skus` (
    `id`, `product_id`, `code`, `name`, `status`, `version`, `created_at`, `updated_at`, `activated_at`, `retired_at`
) VALUES (
    X'019D2D0A000470008000000000000001',
    X'019D2D0A000370008000000000000001',
    _ascii'UPG-INVALID-SKU',
    _utf8mb4'Ambiguous retired history',
    _ascii'RETIRED',
    3,
    '2026-01-01 00:00:00.000001',
    '2026-01-01 00:00:00.000004',
    '2026-01-01 00:00:00.000002',
    '2026-01-01 00:00:00.000003'
);
