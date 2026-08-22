SET SESSION cte_max_recursion_depth = 10001;

-- Exceed the one-release backfill budget with otherwise valid Draft rows. The
-- migration must abort before DDL instead of silently increasing its bound.
INSERT INTO `catalog_products` (
    `id`, `name`, `status`, `version`, `created_at`, `updated_at`, `activated_at`, `archived_at`
)
WITH RECURSIVE `sequence` (`row_number`) AS (
    SELECT 1
    UNION ALL
    SELECT `row_number` + 1
    FROM `sequence`
    WHERE `row_number` < 10001
)
SELECT
    UNHEX(CONCAT(_ascii'019D2D0A0006700080', LPAD(HEX(`row_number`), 14, _ascii'0'))),
    CONCAT(_utf8mb4'Oversized fixture ', `row_number`),
    _ascii'DRAFT',
    1,
    '2026-01-01 00:00:00.000001',
    '2026-01-01 00:00:00.000001',
    NULL,
    NULL
FROM `sequence`;
