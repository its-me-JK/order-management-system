-- Re-enabling FOREIGN_KEY_CHECKS does not retroactively validate rows written
-- while it was disabled, so FK metadata alone is insufficient preflight proof.
SET SESSION FOREIGN_KEY_CHECKS = 0;

INSERT INTO `catalog_skus` (
    `id`, `product_id`, `code`, `name`, `status`, `version`,
    `created_at`, `updated_at`, `activated_at`, `retired_at`
) VALUES (
    X'019D2D0A000970008000000000000001',
    X'019D2D0A000970008000000000000002',
    _ascii'UPG-ORPHAN-SKU',
    _utf8mb4'Orphaned SKU',
    _ascii'DRAFT',
    1,
    '2026-01-01 00:00:00.000001',
    '2026-01-01 00:00:00.000001',
    NULL,
    NULL
);

SET SESSION FOREIGN_KEY_CHECKS = 1;
