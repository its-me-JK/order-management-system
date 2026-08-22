SET SESSION cte_max_recursion_depth = 10001;

INSERT INTO `catalog_products` (
    `id`, `name`, `status`, `version`, `created_at`, `updated_at`, `activated_at`, `archived_at`
) VALUES (
    X'019D2D0A000770008000000000000001',
    _utf8mb4'Oversized SKU parent',
    _ascii'DRAFT',
    1,
    '2026-01-01 00:00:00.000001',
    '2026-01-01 00:00:00.000001',
    NULL,
    NULL
);

-- Exercise the independent SKU bound; an oversized Product fixture would
-- abort before proving this table's guard.
INSERT INTO `catalog_skus` (
    `id`, `product_id`, `code`, `name`, `status`, `version`,
    `created_at`, `updated_at`, `activated_at`, `retired_at`
)
WITH RECURSIVE `sequence` (`row_number`) AS (
    SELECT 1
    UNION ALL
    SELECT `row_number` + 1
    FROM `sequence`
    WHERE `row_number` < 10001
)
SELECT
    UNHEX(CONCAT(_ascii'019D2D0A0008700080', LPAD(HEX(`row_number`), 14, _ascii'0'))),
    X'019D2D0A000770008000000000000001',
    CONCAT(_ascii'UPG-BOUND-', LPAD(`row_number`, 5, _ascii'0')),
    CONCAT(_utf8mb4'Oversized SKU fixture ', `row_number`),
    _ascii'DRAFT',
    1,
    '2026-01-01 00:00:00.000001',
    '2026-01-01 00:00:00.000001',
    NULL,
    NULL
FROM `sequence`;
