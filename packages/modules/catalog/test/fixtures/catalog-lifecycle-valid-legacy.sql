INSERT INTO `catalog_products` (
    `id`, `name`, `status`, `version`, `created_at`, `updated_at`, `activated_at`, `archived_at`
) VALUES
    (X'019D2D0A000070008000000000000001', _utf8mb4'Draft unchanged', _ascii'DRAFT', 1, '2026-01-01 00:00:00.000001', '2026-01-01 00:00:00.000001', NULL, NULL),
    (X'019D2D0A000070008000000000000002', _utf8mb4'Draft renamed', _ascii'DRAFT', 1, '2026-01-01 00:00:00.000001', '2026-01-01 00:00:00.000004', NULL, NULL),
    (X'019D2D0A000070008000000000000003', _utf8mb4'First active', _ascii'ACTIVE', 1, '2026-01-01 00:00:00.000001', '2026-01-01 00:00:00.000002', '2026-01-01 00:00:00.000002', NULL),
    (X'019D2D0A000070008000000000000004', _utf8mb4'Active renamed', _ascii'ACTIVE', 1, '2026-01-01 00:00:00.000001', '2026-01-01 00:00:00.000004', '2026-01-01 00:00:00.000002', NULL),
    (X'019D2D0A000070008000000000000005', _utf8mb4'High version active', _ascii'ACTIVE', 9, '2026-01-01 00:00:00.000001', '2026-01-01 00:00:00.000004', '2026-01-01 00:00:00.000002', NULL),
    (X'019D2D0A000070008000000000000006', _utf8mb4'Archived', _ascii'ARCHIVED', 1, '2026-01-01 00:00:00.000001', '2026-01-01 00:00:00.000004', '2026-01-01 00:00:00.000002', '2026-01-01 00:00:00.000004');

INSERT INTO `catalog_skus` (
    `id`, `product_id`, `code`, `name`, `status`, `version`, `created_at`, `updated_at`, `activated_at`, `retired_at`
) VALUES
    (X'019D2D0A000170008000000000000001', X'019D2D0A000070008000000000000001', _ascii'UPG-DRAFT-1', _utf8mb4'Draft unchanged', _ascii'DRAFT', 1, '2026-01-01 00:00:00.000001', '2026-01-01 00:00:00.000001', NULL, NULL),
    (X'019D2D0A000170008000000000000002', X'019D2D0A000070008000000000000001', _ascii'UPG-DRAFT-2', _utf8mb4'Draft renamed', _ascii'DRAFT', 1, '2026-01-01 00:00:00.000001', '2026-01-01 00:00:00.000004', NULL, NULL),
    (X'019D2D0A000170008000000000000003', X'019D2D0A000070008000000000000003', _ascii'UPG-ACTIVE-1', _utf8mb4'First active', _ascii'ACTIVE', 1, '2026-01-01 00:00:00.000001', '2026-01-01 00:00:00.000002', '2026-01-01 00:00:00.000002', NULL),
    (X'019D2D0A000170008000000000000004', X'019D2D0A000070008000000000000003', _ascii'UPG-ACTIVE-2', _utf8mb4'Active renamed', _ascii'ACTIVE', 1, '2026-01-01 00:00:00.000001', '2026-01-01 00:00:00.000004', '2026-01-01 00:00:00.000002', NULL),
    (X'019D2D0A000170008000000000000005', X'019D2D0A000070008000000000000005', _ascii'UPG-ACTIVE-9', _utf8mb4'High version active', _ascii'ACTIVE', 8, '2026-01-01 00:00:00.000001', '2026-01-01 00:00:00.000004', '2026-01-01 00:00:00.000002', NULL),
    (X'019D2D0A000170008000000000000006', X'019D2D0A000070008000000000000006', _ascii'UPG-RETIRED-1', _utf8mb4'Activated retired', _ascii'RETIRED', 1, '2026-01-01 00:00:00.000001', '2026-01-01 00:00:00.000004', '2026-01-01 00:00:00.000002', '2026-01-01 00:00:00.000004'),
    (X'019D2D0A000170008000000000000007', X'019D2D0A000070008000000000000001', _ascii'UPG-RETIRED-2', _utf8mb4'Draft retired', _ascii'RETIRED', 1, '2026-01-01 00:00:00.000001', '2026-01-01 00:00:00.000004', NULL, '2026-01-01 00:00:00.000004');

-- Reconstruct the exact ledger state produced by the prior release so Prisma
-- applies only the forward lifecycle migration. The checksum pins the already
-- published migration and intentionally fails if its immutable SQL changes.
CREATE TABLE `_prisma_migrations` (
    `id` VARCHAR(36) COLLATE utf8mb4_unicode_ci NOT NULL,
    `checksum` VARCHAR(64) COLLATE utf8mb4_unicode_ci NOT NULL,
    `finished_at` DATETIME(3) NULL,
    `migration_name` VARCHAR(255) COLLATE utf8mb4_unicode_ci NOT NULL,
    `logs` TEXT COLLATE utf8mb4_unicode_ci NULL,
    `rolled_back_at` DATETIME(3) NULL,
    `started_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `applied_steps_count` INTEGER UNSIGNED NOT NULL DEFAULT 0,
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `_prisma_migrations` (
    `id`, `checksum`, `finished_at`, `migration_name`, `logs`,
    `rolled_back_at`, `started_at`, `applied_steps_count`
) VALUES (
    _ascii'00000000-0000-4000-8000-000000000001',
    _ascii'51cce06fc9161ad29fbe602a150270e7a45b8d87942ea9ca81a6fa852a8fa5b4',
    '2026-08-22 00:00:00.000',
    _ascii'20260822145724_create_catalog',
    NULL,
    NULL,
    '2026-08-22 00:00:00.000',
    1
);

CREATE TABLE `catalog_products_before_lifecycle_upgrade` AS
SELECT
    `id`, `name`, `status`, `version`, `created_at`, `updated_at`, `activated_at`, `archived_at`
FROM `catalog_products`;

CREATE TABLE `catalog_skus_before_lifecycle_upgrade` AS
SELECT
    `id`, `product_id`, `code`, `name`, `status`, `version`, `created_at`, `updated_at`, `activated_at`, `retired_at`
FROM `catalog_skus`;
