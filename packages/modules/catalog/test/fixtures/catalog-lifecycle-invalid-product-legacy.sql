-- This row is valid under the prior contract, but its terminal transition time
-- cannot be recovered: the legacy update timestamp occurred after archival.
INSERT INTO `catalog_products` (
    `id`, `name`, `status`, `version`, `created_at`, `updated_at`, `activated_at`, `archived_at`
) VALUES (
    X'019D2D0A000270008000000000000001',
    _utf8mb4'Ambiguous archived history',
    _ascii'ARCHIVED',
    3,
    '2026-01-01 00:00:00.000001',
    '2026-01-01 00:00:00.000004',
    '2026-01-01 00:00:00.000002',
    '2026-01-01 00:00:00.000003'
);
