-- Catalog owns product merchandising identity and independently stockable SKU
-- identity. Prices and inventory deliberately belong to other modules.

-- CreateTable
CREATE TABLE `catalog_products` (
    `id` BINARY(16) NOT NULL,
    `name` VARCHAR(160) NOT NULL,
    `status` VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    `version` INTEGER UNSIGNED NOT NULL DEFAULT 1,
    `created_at` DATETIME(6) NOT NULL,
    `updated_at` DATETIME(6) NOT NULL,
    `activated_at` DATETIME(6) NULL,
    `archived_at` DATETIME(6) NULL,

    CONSTRAINT `ck_catalog_products_name_nonblank`
        CHECK (
            CHAR_LENGTH(`name`) BETWEEN 1 AND 160
            AND NOT REGEXP_LIKE(`name`, _utf8mb4'\\p{Cc}', _ascii'c')
            AND NOT REGEXP_LIKE(
                `name`,
                _utf8mb4'^(?:\\p{White_Space})|(?:\\p{White_Space})$',
                _ascii'c'
            )
        ),
    CONSTRAINT `ck_catalog_products_status`
        CHECK (`status` IN (_ascii'DRAFT', _ascii'ACTIVE', _ascii'ARCHIVED')),
    CONSTRAINT `ck_catalog_products_version`
        CHECK (`version` >= 1),
    CONSTRAINT `ck_catalog_products_lifecycle`
        CHECK (
            (`status` = _ascii'DRAFT' AND `activated_at` IS NULL AND `archived_at` IS NULL)
            OR (`status` = _ascii'ACTIVE' AND `activated_at` IS NOT NULL AND `archived_at` IS NULL)
            OR (`status` = _ascii'ARCHIVED' AND `activated_at` IS NOT NULL AND `archived_at` IS NOT NULL)
        ),
    CONSTRAINT `ck_catalog_products_timestamp_order`
        CHECK (
            `updated_at` >= `created_at`
            AND (`activated_at` IS NULL OR (`activated_at` >= `created_at` AND `activated_at` <= `updated_at`))
            AND (`archived_at` IS NULL OR (`archived_at` >= `activated_at` AND `archived_at` <= `updated_at`))
        ),

    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

-- CreateTable
CREATE TABLE `catalog_skus` (
    `id` BINARY(16) NOT NULL,
    `product_id` BINARY(16) NOT NULL,
    `code` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    `name` VARCHAR(160) NOT NULL,
    `status` VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    `version` INTEGER UNSIGNED NOT NULL DEFAULT 1,
    `created_at` DATETIME(6) NOT NULL,
    `updated_at` DATETIME(6) NOT NULL,
    `activated_at` DATETIME(6) NULL,
    `retired_at` DATETIME(6) NULL,

    CONSTRAINT `ck_catalog_skus_code_format`
        CHECK (REGEXP_LIKE(`code`, _ascii'^[A-Z0-9][A-Z0-9._-]{2,63}$', _ascii'c')),
    CONSTRAINT `ck_catalog_skus_name_nonblank`
        CHECK (
            CHAR_LENGTH(`name`) BETWEEN 1 AND 160
            AND NOT REGEXP_LIKE(`name`, _utf8mb4'\\p{Cc}', _ascii'c')
            AND NOT REGEXP_LIKE(
                `name`,
                _utf8mb4'^(?:\\p{White_Space})|(?:\\p{White_Space})$',
                _ascii'c'
            )
        ),
    CONSTRAINT `ck_catalog_skus_status`
        CHECK (`status` IN (_ascii'DRAFT', _ascii'ACTIVE', _ascii'RETIRED')),
    CONSTRAINT `ck_catalog_skus_version`
        CHECK (`version` >= 1),
    CONSTRAINT `ck_catalog_skus_lifecycle`
        CHECK (
            (`status` = _ascii'DRAFT' AND `activated_at` IS NULL AND `retired_at` IS NULL)
            OR (`status` = _ascii'ACTIVE' AND `activated_at` IS NOT NULL AND `retired_at` IS NULL)
            OR (`status` = _ascii'RETIRED' AND `retired_at` IS NOT NULL)
        ),
    CONSTRAINT `ck_catalog_skus_timestamp_order`
        CHECK (
            `updated_at` >= `created_at`
            AND (`activated_at` IS NULL OR (`activated_at` >= `created_at` AND `activated_at` <= `updated_at`))
            AND (
                `retired_at` IS NULL
                OR (
                    `retired_at` >= COALESCE(`activated_at`, `created_at`)
                    AND `retired_at` <= `updated_at`
                )
            )
        ),

    INDEX `ix_catalog_skus_public_traversal` (`status`, `created_at`, `id`),
    INDEX `ix_catalog_skus_product_status_traversal` (`product_id`, `status`, `created_at`, `id`),
    UNIQUE INDEX `uq_catalog_skus_code` (`code`),
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

-- AddForeignKey
ALTER TABLE `catalog_skus`
    ADD CONSTRAINT `fk_catalog_skus_product`
    FOREIGN KEY (`product_id`) REFERENCES `catalog_products` (`id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT;
