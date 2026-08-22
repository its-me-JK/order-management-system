CREATE TEMPORARY TABLE `_catalog_lifecycle_upgrade_assertion` (
    `invalid_rows` BIGINT UNSIGNED NOT NULL,
    CONSTRAINT `ck_catalog_lifecycle_upgrade_assertion`
        CHECK (`invalid_rows` = 0)
);

INSERT INTO `_catalog_lifecycle_upgrade_assertion` (`invalid_rows`)
SELECT
    ABS((SELECT COUNT(*) FROM `catalog_products`) - 6)
    + ABS((SELECT COUNT(*) FROM `catalog_skus`) - 7);

-- Every pre-existing business field, including all timestamps, remains unchanged.
INSERT INTO `_catalog_lifecycle_upgrade_assertion` (`invalid_rows`)
SELECT COUNT(*)
FROM `catalog_products` AS `current`
LEFT JOIN `catalog_products_before_lifecycle_upgrade` AS `prior`
    ON `prior`.`id` = `current`.`id`
WHERE
    `prior`.`id` IS NULL
    OR NOT (BINARY `current`.`name` <=> BINARY `prior`.`name`)
    OR NOT (BINARY `current`.`status` <=> BINARY `prior`.`status`)
    OR NOT (`current`.`created_at` <=> `prior`.`created_at`)
    OR NOT (`current`.`updated_at` <=> `prior`.`updated_at`)
    OR NOT (`current`.`activated_at` <=> `prior`.`activated_at`)
    OR NOT (`current`.`archived_at` <=> `prior`.`archived_at`);

INSERT INTO `_catalog_lifecycle_upgrade_assertion` (`invalid_rows`)
SELECT COUNT(*)
FROM `catalog_skus` AS `current`
LEFT JOIN `catalog_skus_before_lifecycle_upgrade` AS `prior`
    ON `prior`.`id` = `current`.`id`
WHERE
    `prior`.`id` IS NULL
    OR NOT (`current`.`product_id` <=> `prior`.`product_id`)
    OR NOT (BINARY `current`.`code` <=> BINARY `prior`.`code`)
    OR NOT (BINARY `current`.`name` <=> BINARY `prior`.`name`)
    OR NOT (BINARY `current`.`status` <=> BINARY `prior`.`status`)
    OR NOT (`current`.`created_at` <=> `prior`.`created_at`)
    OR NOT (`current`.`updated_at` <=> `prior`.`updated_at`)
    OR NOT (`current`.`activated_at` <=> `prior`.`activated_at`)
    OR NOT (`current`.`retired_at` <=> `prior`.`retired_at`);

-- Lifecycle time is deterministic and only insufficient concurrency tokens rise.
INSERT INTO `_catalog_lifecycle_upgrade_assertion` (`invalid_rows`)
SELECT COUNT(*)
FROM `catalog_products`
WHERE
    NOT (
        `status_changed_at` <=> CASE `status`
            WHEN _ascii'DRAFT' THEN `created_at`
            WHEN _ascii'ACTIVE' THEN `activated_at`
            WHEN _ascii'ARCHIVED' THEN `archived_at`
        END
    )
    OR `version` <> CASE HEX(`id`)
        WHEN _ascii'019D2D0A000070008000000000000001' THEN 1
        WHEN _ascii'019D2D0A000070008000000000000002' THEN 2
        WHEN _ascii'019D2D0A000070008000000000000003' THEN 2
        WHEN _ascii'019D2D0A000070008000000000000004' THEN 3
        WHEN _ascii'019D2D0A000070008000000000000005' THEN 9
        WHEN _ascii'019D2D0A000070008000000000000006' THEN 3
        ELSE 0
    END;

INSERT INTO `_catalog_lifecycle_upgrade_assertion` (`invalid_rows`)
SELECT COUNT(*)
FROM `catalog_skus`
WHERE
    NOT (
        `status_changed_at` <=> CASE `status`
            WHEN _ascii'DRAFT' THEN `created_at`
            WHEN _ascii'ACTIVE' THEN `activated_at`
            WHEN _ascii'RETIRED' THEN `retired_at`
        END
    )
    OR `version` <> CASE HEX(`id`)
        WHEN _ascii'019D2D0A000170008000000000000001' THEN 1
        WHEN _ascii'019D2D0A000170008000000000000002' THEN 2
        WHEN _ascii'019D2D0A000170008000000000000003' THEN 2
        WHEN _ascii'019D2D0A000170008000000000000004' THEN 3
        WHEN _ascii'019D2D0A000170008000000000000005' THEN 8
        WHEN _ascii'019D2D0A000170008000000000000006' THEN 3
        WHEN _ascii'019D2D0A000170008000000000000007' THEN 2
        ELSE 0
    END;

INSERT INTO `_catalog_lifecycle_upgrade_assertion` (`invalid_rows`)
SELECT CASE
    WHEN (
        SELECT COUNT(*)
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME IN (_utf8mb4'catalog_products', _utf8mb4'catalog_skus')
          AND COLUMN_NAME = _utf8mb4'status_changed_at'
          AND COLUMN_TYPE = _utf8mb4'datetime(6)'
          AND IS_NULLABLE = _utf8mb4'NO'
    ) = 2
    AND (
        SELECT COUNT(*)
        FROM information_schema.TABLE_CONSTRAINTS
        WHERE CONSTRAINT_SCHEMA = DATABASE()
          AND CONSTRAINT_TYPE = _utf8mb4'CHECK'
          AND ENFORCED = _utf8mb4'YES'
          AND (
              (
                  TABLE_NAME = _utf8mb4'catalog_products'
                  AND CONSTRAINT_NAME IN (
                      _utf8mb4'ck_catalog_products_status',
                      _utf8mb4'ck_catalog_products_version',
                      _utf8mb4'ck_catalog_products_lifecycle',
                      _utf8mb4'ck_catalog_products_timestamp_order'
                  )
              )
              OR (
                  TABLE_NAME = _utf8mb4'catalog_skus'
                  AND CONSTRAINT_NAME IN (
                      _utf8mb4'ck_catalog_skus_status',
                      _utf8mb4'ck_catalog_skus_version',
                      _utf8mb4'ck_catalog_skus_lifecycle',
                      _utf8mb4'ck_catalog_skus_timestamp_order'
                  )
              )
          )
    ) = 8
    THEN 0
    ELSE 1
END;

SELECT _utf8mb4'Catalog lifecycle prior-schema upgrade verified';
