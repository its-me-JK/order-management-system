-- Expand Catalog lifecycle persistence before any administrative writer is enabled.
-- MySQL DDL is atomic per statement, not across this file, so validate all legacy
-- data before the first persistent DDL and keep each table's contract swap atomic.
-- Making a nullable DATETIME(6) column non-null requires ALGORITHM=COPY on the
-- pinned MySQL release; LOCK=SHARED makes that bounded maintenance cost explicit.

SET SESSION lock_wait_timeout = 15;
SET SESSION innodb_lock_wait_timeout = 15;

CREATE TEMPORARY TABLE `_catalog_lifecycle_migration_guard` (
    `invalid_rows` BIGINT UNSIGNED NOT NULL,
    CONSTRAINT `ck_catalog_lifecycle_migration_guard`
        CHECK (`invalid_rows` = 0)
);

-- Refuse drift or a retry after partial DDL instead of hiding it with IF EXISTS.
INSERT INTO `_catalog_lifecycle_migration_guard` (`invalid_rows`)
SELECT CASE
    WHEN
        (
            SELECT COUNT(*)
            FROM information_schema.TABLES
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME IN (_utf8mb4'catalog_products', _utf8mb4'catalog_skus')
              AND ENGINE = _utf8mb4'InnoDB'
              AND TABLE_COLLATION = _utf8mb4'utf8mb4_0900_ai_ci'
        ) = 2
        AND (
            SELECT COUNT(*)
            FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE()
              AND (
                  (
                      TABLE_NAME = _utf8mb4'catalog_products'
                      AND (
                          (COLUMN_NAME = _utf8mb4'status' AND COLUMN_TYPE = _utf8mb4'varchar(16)' AND IS_NULLABLE = _utf8mb4'NO')
                          OR (COLUMN_NAME = _utf8mb4'version' AND COLUMN_TYPE = _utf8mb4'int unsigned' AND IS_NULLABLE = _utf8mb4'NO')
                          OR (COLUMN_NAME IN (_utf8mb4'created_at', _utf8mb4'updated_at') AND COLUMN_TYPE = _utf8mb4'datetime(6)' AND IS_NULLABLE = _utf8mb4'NO')
                          OR (COLUMN_NAME IN (_utf8mb4'activated_at', _utf8mb4'archived_at') AND COLUMN_TYPE = _utf8mb4'datetime(6)' AND IS_NULLABLE = _utf8mb4'YES')
                      )
                  )
                  OR (
                      TABLE_NAME = _utf8mb4'catalog_skus'
                      AND (
                          (COLUMN_NAME = _utf8mb4'status' AND COLUMN_TYPE = _utf8mb4'varchar(16)' AND IS_NULLABLE = _utf8mb4'NO')
                          OR (COLUMN_NAME = _utf8mb4'version' AND COLUMN_TYPE = _utf8mb4'int unsigned' AND IS_NULLABLE = _utf8mb4'NO')
                          OR (COLUMN_NAME IN (_utf8mb4'created_at', _utf8mb4'updated_at') AND COLUMN_TYPE = _utf8mb4'datetime(6)' AND IS_NULLABLE = _utf8mb4'NO')
                          OR (COLUMN_NAME IN (_utf8mb4'activated_at', _utf8mb4'retired_at') AND COLUMN_TYPE = _utf8mb4'datetime(6)' AND IS_NULLABLE = _utf8mb4'YES')
                      )
                  )
              )
        ) = 12
        AND (
            SELECT COUNT(*)
            FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME IN (_utf8mb4'catalog_products', _utf8mb4'catalog_skus')
              AND COLUMN_NAME = _utf8mb4'status_changed_at'
        ) = 0
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
        AND (SELECT COUNT(*) FROM `catalog_products`) <= 10000
        AND (SELECT COUNT(*) FROM `catalog_skus`) <= 10000
    THEN 0
    ELSE 1
END;

-- Pin the complete prior column contract so this migration cannot bless a
-- drifted database while leaving an untouched invariant weakened.
INSERT INTO `_catalog_lifecycle_migration_guard` (`invalid_rows`)
SELECT CASE
    WHEN (
        SELECT COUNT(*)
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME IN (_utf8mb4'catalog_products', _utf8mb4'catalog_skus')
    ) = 18
    AND (
        SELECT COUNT(*)
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND (
              (
                  TABLE_NAME = _utf8mb4'catalog_products'
                  AND (
                      (ORDINAL_POSITION = 1 AND COLUMN_NAME = _utf8mb4'id' AND COLUMN_TYPE = _utf8mb4'binary(16)' AND IS_NULLABLE = _utf8mb4'NO' AND COLUMN_DEFAULT IS NULL AND CHARACTER_SET_NAME IS NULL AND COLLATION_NAME IS NULL AND EXTRA = _utf8mb4'')
                      OR (ORDINAL_POSITION = 2 AND COLUMN_NAME = _utf8mb4'name' AND COLUMN_TYPE = _utf8mb4'varchar(160)' AND IS_NULLABLE = _utf8mb4'NO' AND COLUMN_DEFAULT IS NULL AND CHARACTER_SET_NAME = _utf8mb4'utf8mb4' AND COLLATION_NAME = _utf8mb4'utf8mb4_0900_ai_ci' AND EXTRA = _utf8mb4'')
                      OR (ORDINAL_POSITION = 3 AND COLUMN_NAME = _utf8mb4'status' AND COLUMN_TYPE = _utf8mb4'varchar(16)' AND IS_NULLABLE = _utf8mb4'NO' AND COLUMN_DEFAULT IS NULL AND CHARACTER_SET_NAME = _utf8mb4'ascii' AND COLLATION_NAME = _utf8mb4'ascii_bin' AND EXTRA = _utf8mb4'')
                      OR (ORDINAL_POSITION = 4 AND COLUMN_NAME = _utf8mb4'version' AND COLUMN_TYPE = _utf8mb4'int unsigned' AND IS_NULLABLE = _utf8mb4'NO' AND COLUMN_DEFAULT = _utf8mb4'1' AND CHARACTER_SET_NAME IS NULL AND COLLATION_NAME IS NULL AND EXTRA = _utf8mb4'')
                      OR (ORDINAL_POSITION = 5 AND COLUMN_NAME = _utf8mb4'created_at' AND COLUMN_TYPE = _utf8mb4'datetime(6)' AND IS_NULLABLE = _utf8mb4'NO' AND COLUMN_DEFAULT IS NULL AND CHARACTER_SET_NAME IS NULL AND COLLATION_NAME IS NULL AND EXTRA = _utf8mb4'')
                      OR (ORDINAL_POSITION = 6 AND COLUMN_NAME = _utf8mb4'updated_at' AND COLUMN_TYPE = _utf8mb4'datetime(6)' AND IS_NULLABLE = _utf8mb4'NO' AND COLUMN_DEFAULT IS NULL AND CHARACTER_SET_NAME IS NULL AND COLLATION_NAME IS NULL AND EXTRA = _utf8mb4'')
                      OR (ORDINAL_POSITION = 7 AND COLUMN_NAME = _utf8mb4'activated_at' AND COLUMN_TYPE = _utf8mb4'datetime(6)' AND IS_NULLABLE = _utf8mb4'YES' AND COLUMN_DEFAULT IS NULL AND CHARACTER_SET_NAME IS NULL AND COLLATION_NAME IS NULL AND EXTRA = _utf8mb4'')
                      OR (ORDINAL_POSITION = 8 AND COLUMN_NAME = _utf8mb4'archived_at' AND COLUMN_TYPE = _utf8mb4'datetime(6)' AND IS_NULLABLE = _utf8mb4'YES' AND COLUMN_DEFAULT IS NULL AND CHARACTER_SET_NAME IS NULL AND COLLATION_NAME IS NULL AND EXTRA = _utf8mb4'')
                  )
              )
              OR (
                  TABLE_NAME = _utf8mb4'catalog_skus'
                  AND (
                      (ORDINAL_POSITION = 1 AND COLUMN_NAME = _utf8mb4'id' AND COLUMN_TYPE = _utf8mb4'binary(16)' AND IS_NULLABLE = _utf8mb4'NO' AND COLUMN_DEFAULT IS NULL AND CHARACTER_SET_NAME IS NULL AND COLLATION_NAME IS NULL AND EXTRA = _utf8mb4'')
                      OR (ORDINAL_POSITION = 2 AND COLUMN_NAME = _utf8mb4'product_id' AND COLUMN_TYPE = _utf8mb4'binary(16)' AND IS_NULLABLE = _utf8mb4'NO' AND COLUMN_DEFAULT IS NULL AND CHARACTER_SET_NAME IS NULL AND COLLATION_NAME IS NULL AND EXTRA = _utf8mb4'')
                      OR (ORDINAL_POSITION = 3 AND COLUMN_NAME = _utf8mb4'code' AND COLUMN_TYPE = _utf8mb4'varchar(64)' AND IS_NULLABLE = _utf8mb4'NO' AND COLUMN_DEFAULT IS NULL AND CHARACTER_SET_NAME = _utf8mb4'ascii' AND COLLATION_NAME = _utf8mb4'ascii_bin' AND EXTRA = _utf8mb4'')
                      OR (ORDINAL_POSITION = 4 AND COLUMN_NAME = _utf8mb4'name' AND COLUMN_TYPE = _utf8mb4'varchar(160)' AND IS_NULLABLE = _utf8mb4'NO' AND COLUMN_DEFAULT IS NULL AND CHARACTER_SET_NAME = _utf8mb4'utf8mb4' AND COLLATION_NAME = _utf8mb4'utf8mb4_0900_ai_ci' AND EXTRA = _utf8mb4'')
                      OR (ORDINAL_POSITION = 5 AND COLUMN_NAME = _utf8mb4'status' AND COLUMN_TYPE = _utf8mb4'varchar(16)' AND IS_NULLABLE = _utf8mb4'NO' AND COLUMN_DEFAULT IS NULL AND CHARACTER_SET_NAME = _utf8mb4'ascii' AND COLLATION_NAME = _utf8mb4'ascii_bin' AND EXTRA = _utf8mb4'')
                      OR (ORDINAL_POSITION = 6 AND COLUMN_NAME = _utf8mb4'version' AND COLUMN_TYPE = _utf8mb4'int unsigned' AND IS_NULLABLE = _utf8mb4'NO' AND COLUMN_DEFAULT = _utf8mb4'1' AND CHARACTER_SET_NAME IS NULL AND COLLATION_NAME IS NULL AND EXTRA = _utf8mb4'')
                      OR (ORDINAL_POSITION = 7 AND COLUMN_NAME = _utf8mb4'created_at' AND COLUMN_TYPE = _utf8mb4'datetime(6)' AND IS_NULLABLE = _utf8mb4'NO' AND COLUMN_DEFAULT IS NULL AND CHARACTER_SET_NAME IS NULL AND COLLATION_NAME IS NULL AND EXTRA = _utf8mb4'')
                      OR (ORDINAL_POSITION = 8 AND COLUMN_NAME = _utf8mb4'updated_at' AND COLUMN_TYPE = _utf8mb4'datetime(6)' AND IS_NULLABLE = _utf8mb4'NO' AND COLUMN_DEFAULT IS NULL AND CHARACTER_SET_NAME IS NULL AND COLLATION_NAME IS NULL AND EXTRA = _utf8mb4'')
                      OR (ORDINAL_POSITION = 9 AND COLUMN_NAME = _utf8mb4'activated_at' AND COLUMN_TYPE = _utf8mb4'datetime(6)' AND IS_NULLABLE = _utf8mb4'YES' AND COLUMN_DEFAULT IS NULL AND CHARACTER_SET_NAME IS NULL AND COLLATION_NAME IS NULL AND EXTRA = _utf8mb4'')
                      OR (ORDINAL_POSITION = 10 AND COLUMN_NAME = _utf8mb4'retired_at' AND COLUMN_TYPE = _utf8mb4'datetime(6)' AND IS_NULLABLE = _utf8mb4'YES' AND COLUMN_DEFAULT IS NULL AND CHARACTER_SET_NAME IS NULL AND COLLATION_NAME IS NULL AND EXTRA = _utf8mb4'')
                  )
              )
          )
    ) = 18
    THEN 0
    ELSE 1
END;

-- Exact hashes are intentionally coupled to normalization by pinned MySQL
-- 8.4.11. They cover all prior checks, including the untouched name and code
-- guards, without embedding row values or executing dynamic SQL.
INSERT INTO `_catalog_lifecycle_migration_guard` (`invalid_rows`)
SELECT CASE
    WHEN COUNT(*) = 11
      AND SUM(
          CASE CONCAT(`table_constraints`.`TABLE_NAME`, _utf8mb4'.', `table_constraints`.`CONSTRAINT_NAME`)
              WHEN _utf8mb4'catalog_products.ck_catalog_products_lifecycle' THEN SHA2(`check_constraints`.`CHECK_CLAUSE`, 256) = _ascii'abc44b4f95d867000b589a9ae6b23585b8da51364af154744b3ed2248a7b2e51'
              WHEN _utf8mb4'catalog_products.ck_catalog_products_name_nonblank' THEN SHA2(`check_constraints`.`CHECK_CLAUSE`, 256) = _ascii'b3da478e22edab2a25537a144ce5bb31dfb0c1c9aa452e19039cc9d45cfd3dcd'
              WHEN _utf8mb4'catalog_products.ck_catalog_products_status' THEN SHA2(`check_constraints`.`CHECK_CLAUSE`, 256) = _ascii'488abb163915a389a2b21f72b3973db1c774096a876d072fa48365ab7a7c31ee'
              WHEN _utf8mb4'catalog_products.ck_catalog_products_timestamp_order' THEN SHA2(`check_constraints`.`CHECK_CLAUSE`, 256) = _ascii'911eadd42fd7cf46f95abd49f9fff58adc49ce25462fdb590a26b6e8e703df28'
              WHEN _utf8mb4'catalog_products.ck_catalog_products_version' THEN SHA2(`check_constraints`.`CHECK_CLAUSE`, 256) = _ascii'4fb7e1f4cf6a4a2139e4b031e8841e6ec455940a5cff9608b63396d68668c638'
              WHEN _utf8mb4'catalog_skus.ck_catalog_skus_code_format' THEN SHA2(`check_constraints`.`CHECK_CLAUSE`, 256) = _ascii'39a2cebff5e353017b834e7d940b8eff309096f7f894a329bc867c779b2c1b73'
              WHEN _utf8mb4'catalog_skus.ck_catalog_skus_lifecycle' THEN SHA2(`check_constraints`.`CHECK_CLAUSE`, 256) = _ascii'e4c812742b173272ff30b2c43385ffcf15998c8fc32841346a3ac9b2452a3f33'
              WHEN _utf8mb4'catalog_skus.ck_catalog_skus_name_nonblank' THEN SHA2(`check_constraints`.`CHECK_CLAUSE`, 256) = _ascii'b3da478e22edab2a25537a144ce5bb31dfb0c1c9aa452e19039cc9d45cfd3dcd'
              WHEN _utf8mb4'catalog_skus.ck_catalog_skus_status' THEN SHA2(`check_constraints`.`CHECK_CLAUSE`, 256) = _ascii'318a5621a5cfa2f7b384da5d5a7216cd8410652469cfe8b4be4a7a17445ad1b5'
              WHEN _utf8mb4'catalog_skus.ck_catalog_skus_timestamp_order' THEN SHA2(`check_constraints`.`CHECK_CLAUSE`, 256) = _ascii'19f19f880bb6e534000898fb17699fd1cbed9297d5b9b914802601b887d19f35'
              WHEN _utf8mb4'catalog_skus.ck_catalog_skus_version' THEN SHA2(`check_constraints`.`CHECK_CLAUSE`, 256) = _ascii'4fb7e1f4cf6a4a2139e4b031e8841e6ec455940a5cff9608b63396d68668c638'
              ELSE FALSE
          END
      ) = 11
    THEN 0
    ELSE 1
END
FROM information_schema.TABLE_CONSTRAINTS AS `table_constraints`
INNER JOIN information_schema.CHECK_CONSTRAINTS AS `check_constraints`
    ON `check_constraints`.`CONSTRAINT_SCHEMA` = `table_constraints`.`CONSTRAINT_SCHEMA`
   AND `check_constraints`.`CONSTRAINT_NAME` = `table_constraints`.`CONSTRAINT_NAME`
WHERE `table_constraints`.`CONSTRAINT_SCHEMA` = DATABASE()
  AND `table_constraints`.`TABLE_NAME` IN (_utf8mb4'catalog_products', _utf8mb4'catalog_skus')
  AND `table_constraints`.`CONSTRAINT_TYPE` = _utf8mb4'CHECK'
  AND `table_constraints`.`ENFORCED` = _utf8mb4'YES';

-- Preserve exact key, traversal, uniqueness, and ownership contracts.
INSERT INTO `_catalog_lifecycle_migration_guard` (`invalid_rows`)
SELECT CASE
    WHEN COUNT(*) = 10
      AND SUM(
          CASE
              WHEN `TABLE_NAME` = _utf8mb4'catalog_products' AND `INDEX_NAME` = _utf8mb4'PRIMARY' AND `NON_UNIQUE` = 0 AND `SEQ_IN_INDEX` = 1 AND `COLUMN_NAME` = _utf8mb4'id' THEN 1
              WHEN `TABLE_NAME` = _utf8mb4'catalog_skus' AND `INDEX_NAME` = _utf8mb4'PRIMARY' AND `NON_UNIQUE` = 0 AND `SEQ_IN_INDEX` = 1 AND `COLUMN_NAME` = _utf8mb4'id' THEN 1
              WHEN `TABLE_NAME` = _utf8mb4'catalog_skus' AND `INDEX_NAME` = _utf8mb4'uq_catalog_skus_code' AND `NON_UNIQUE` = 0 AND `SEQ_IN_INDEX` = 1 AND `COLUMN_NAME` = _utf8mb4'code' THEN 1
              WHEN `TABLE_NAME` = _utf8mb4'catalog_skus' AND `INDEX_NAME` = _utf8mb4'ix_catalog_skus_public_traversal' AND `NON_UNIQUE` = 1 AND `SEQ_IN_INDEX` = 1 AND `COLUMN_NAME` = _utf8mb4'status' THEN 1
              WHEN `TABLE_NAME` = _utf8mb4'catalog_skus' AND `INDEX_NAME` = _utf8mb4'ix_catalog_skus_public_traversal' AND `NON_UNIQUE` = 1 AND `SEQ_IN_INDEX` = 2 AND `COLUMN_NAME` = _utf8mb4'created_at' THEN 1
              WHEN `TABLE_NAME` = _utf8mb4'catalog_skus' AND `INDEX_NAME` = _utf8mb4'ix_catalog_skus_public_traversal' AND `NON_UNIQUE` = 1 AND `SEQ_IN_INDEX` = 3 AND `COLUMN_NAME` = _utf8mb4'id' THEN 1
              WHEN `TABLE_NAME` = _utf8mb4'catalog_skus' AND `INDEX_NAME` = _utf8mb4'ix_catalog_skus_product_status_traversal' AND `NON_UNIQUE` = 1 AND `SEQ_IN_INDEX` = 1 AND `COLUMN_NAME` = _utf8mb4'product_id' THEN 1
              WHEN `TABLE_NAME` = _utf8mb4'catalog_skus' AND `INDEX_NAME` = _utf8mb4'ix_catalog_skus_product_status_traversal' AND `NON_UNIQUE` = 1 AND `SEQ_IN_INDEX` = 2 AND `COLUMN_NAME` = _utf8mb4'status' THEN 1
              WHEN `TABLE_NAME` = _utf8mb4'catalog_skus' AND `INDEX_NAME` = _utf8mb4'ix_catalog_skus_product_status_traversal' AND `NON_UNIQUE` = 1 AND `SEQ_IN_INDEX` = 3 AND `COLUMN_NAME` = _utf8mb4'created_at' THEN 1
              WHEN `TABLE_NAME` = _utf8mb4'catalog_skus' AND `INDEX_NAME` = _utf8mb4'ix_catalog_skus_product_status_traversal' AND `NON_UNIQUE` = 1 AND `SEQ_IN_INDEX` = 4 AND `COLUMN_NAME` = _utf8mb4'id' THEN 1
              ELSE 0
          END
      ) = 10
      AND MIN(`INDEX_TYPE`) = _utf8mb4'BTREE'
      AND MAX(`INDEX_TYPE`) = _utf8mb4'BTREE'
      AND MIN(`IS_VISIBLE`) = _utf8mb4'YES'
      AND MAX(`IS_VISIBLE`) = _utf8mb4'YES'
      AND MIN(`COLLATION`) = _utf8mb4'A'
      AND MAX(`COLLATION`) = _utf8mb4'A'
      AND SUM(`SUB_PART` IS NOT NULL OR `EXPRESSION` IS NOT NULL) = 0
    THEN 0
    ELSE 1
END
FROM information_schema.STATISTICS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME IN (_utf8mb4'catalog_products', _utf8mb4'catalog_skus');

INSERT INTO `_catalog_lifecycle_migration_guard` (`invalid_rows`)
SELECT CASE
    WHEN COUNT(*) = 1
      AND SUM(
          `key_usage`.`TABLE_NAME` = _utf8mb4'catalog_skus'
          AND `key_usage`.`CONSTRAINT_NAME` = _utf8mb4'fk_catalog_skus_product'
          AND `key_usage`.`COLUMN_NAME` = _utf8mb4'product_id'
          AND `key_usage`.`REFERENCED_TABLE_NAME` = _utf8mb4'catalog_products'
          AND `key_usage`.`REFERENCED_COLUMN_NAME` = _utf8mb4'id'
          AND `referential_constraints`.`UPDATE_RULE` = _utf8mb4'RESTRICT'
          AND `referential_constraints`.`DELETE_RULE` = _utf8mb4'RESTRICT'
      ) = 1
    THEN 0
    ELSE 1
END
FROM information_schema.KEY_COLUMN_USAGE AS `key_usage`
INNER JOIN information_schema.REFERENTIAL_CONSTRAINTS AS `referential_constraints`
    ON `referential_constraints`.`CONSTRAINT_SCHEMA` = `key_usage`.`CONSTRAINT_SCHEMA`
   AND `referential_constraints`.`CONSTRAINT_NAME` = `key_usage`.`CONSTRAINT_NAME`
WHERE `key_usage`.`CONSTRAINT_SCHEMA` = DATABASE()
  AND `key_usage`.`TABLE_NAME` IN (_utf8mb4'catalog_products', _utf8mb4'catalog_skus');

-- A row trigger would execute during the backfill and could mutate business
-- fields outside this migration's explicit SET list.
INSERT INTO `_catalog_lifecycle_migration_guard` (`invalid_rows`)
SELECT COUNT(*)
FROM information_schema.TRIGGERS
WHERE TRIGGER_SCHEMA = DATABASE()
  AND EVENT_OBJECT_TABLE IN (_utf8mb4'catalog_products', _utf8mb4'catalog_skus');

-- Accept only legacy rows that can be represented without inventing timestamps.
INSERT INTO `_catalog_lifecycle_migration_guard` (`invalid_rows`)
SELECT COUNT(*)
FROM `catalog_products`
WHERE
    `version` < 1
    OR `updated_at` < `created_at`
    OR (`activated_at` IS NOT NULL AND (`activated_at` < `created_at` OR `activated_at` > `updated_at`))
    OR (`archived_at` IS NOT NULL AND (`archived_at` < `created_at` OR `archived_at` > `updated_at`))
    OR BINARY `status` NOT IN (_binary'DRAFT', _binary'ACTIVE', _binary'ARCHIVED')
    OR (`status` = _ascii'DRAFT' AND (`activated_at` IS NOT NULL OR `archived_at` IS NOT NULL))
    OR (`status` = _ascii'ACTIVE' AND (`activated_at` IS NULL OR `archived_at` IS NOT NULL))
    OR (
        `status` = _ascii'ARCHIVED'
        AND (
            `activated_at` IS NULL
            OR
            `archived_at` IS NULL
            OR NOT (`archived_at` <=> `updated_at`)
            OR `archived_at` < COALESCE(`activated_at`, `created_at`)
        )
    );

INSERT INTO `_catalog_lifecycle_migration_guard` (`invalid_rows`)
SELECT COUNT(*)
FROM `catalog_skus`
WHERE
    `version` < 1
    OR `updated_at` < `created_at`
    OR (`activated_at` IS NOT NULL AND (`activated_at` < `created_at` OR `activated_at` > `updated_at`))
    OR (`retired_at` IS NOT NULL AND (`retired_at` < `created_at` OR `retired_at` > `updated_at`))
    OR BINARY `status` NOT IN (_binary'DRAFT', _binary'ACTIVE', _binary'RETIRED')
    OR (`status` = _ascii'DRAFT' AND (`activated_at` IS NOT NULL OR `retired_at` IS NOT NULL))
    OR (`status` = _ascii'ACTIVE' AND (`activated_at` IS NULL OR `retired_at` IS NOT NULL))
    OR (
        `status` = _ascii'RETIRED'
        AND (
            `retired_at` IS NULL
            OR NOT (`retired_at` <=> `updated_at`)
            OR `retired_at` < COALESCE(`activated_at`, `created_at`)
        )
    );

-- FK metadata does not prove old rows are valid when a privileged session has
-- previously disabled FOREIGN_KEY_CHECKS.
INSERT INTO `_catalog_lifecycle_migration_guard` (`invalid_rows`)
SELECT COUNT(*)
FROM `catalog_skus` AS `sku`
LEFT JOIN `catalog_products` AS `product`
    ON `product`.`id` = `sku`.`product_id`
WHERE `product`.`id` IS NULL;

ALTER TABLE `catalog_products`
    ADD COLUMN `status_changed_at` DATETIME(6) NULL AFTER `updated_at`,
    ALGORITHM=INSTANT;

ALTER TABLE `catalog_skus`
    ADD COLUMN `status_changed_at` DATETIME(6) NULL AFTER `updated_at`,
    ALGORITHM=INSTANT;

START TRANSACTION;

UPDATE `catalog_products`
SET
    `status_changed_at` = CASE `status`
        WHEN _ascii'DRAFT' THEN `created_at`
        WHEN _ascii'ACTIVE' THEN `activated_at`
        WHEN _ascii'ARCHIVED' THEN `archived_at`
    END,
    `version` = GREATEST(
        `version`,
        CASE `status`
            WHEN _ascii'DRAFT' THEN IF(`updated_at` = `created_at`, 1, 2)
            WHEN _ascii'ACTIVE' THEN IF(`updated_at` = `activated_at`, 2, 3)
            WHEN _ascii'ARCHIVED' THEN IF(`activated_at` IS NULL, 2, 3)
        END
    );

UPDATE `catalog_skus`
SET
    `status_changed_at` = CASE `status`
        WHEN _ascii'DRAFT' THEN `created_at`
        WHEN _ascii'ACTIVE' THEN `activated_at`
        WHEN _ascii'RETIRED' THEN `retired_at`
    END,
    `version` = GREATEST(
        `version`,
        CASE `status`
            WHEN _ascii'DRAFT' THEN IF(`updated_at` = `created_at`, 1, 2)
            WHEN _ascii'ACTIVE' THEN IF(`updated_at` = `activated_at`, 2, 3)
            WHEN _ascii'RETIRED' THEN IF(`activated_at` IS NULL, 2, 3)
        END
    );

COMMIT;

-- Validate the deterministic backfill before either table enters contract phase.
INSERT INTO `_catalog_lifecycle_migration_guard` (`invalid_rows`)
SELECT COUNT(*)
FROM `catalog_products`
WHERE
    `status_changed_at` IS NULL
    OR (`status` = _ascii'DRAFT' AND (`status_changed_at` <> `created_at` OR (`version` = 1 AND `updated_at` <> `created_at`)))
    OR (`status` = _ascii'ACTIVE' AND (`status_changed_at` <> `activated_at` OR `version` < IF(`updated_at` = `activated_at`, 2, 3)))
    OR (`status` = _ascii'ARCHIVED' AND (`status_changed_at` <> `archived_at` OR `version` < IF(`activated_at` IS NULL, 2, 3)));

INSERT INTO `_catalog_lifecycle_migration_guard` (`invalid_rows`)
SELECT COUNT(*)
FROM `catalog_skus`
WHERE
    `status_changed_at` IS NULL
    OR (`status` = _ascii'DRAFT' AND (`status_changed_at` <> `created_at` OR (`version` = 1 AND `updated_at` <> `created_at`)))
    OR (`status` = _ascii'ACTIVE' AND (`status_changed_at` <> `activated_at` OR `version` < IF(`updated_at` = `activated_at`, 2, 3)))
    OR (`status` = _ascii'RETIRED' AND (`status_changed_at` <> `retired_at` OR `version` < IF(`activated_at` IS NULL, 2, 3)));

INSERT INTO `_catalog_lifecycle_migration_guard` (`invalid_rows`)
SELECT COUNT(*)
FROM `catalog_skus` AS `sku`
LEFT JOIN `catalog_products` AS `product`
    ON `product`.`id` = `sku`.`product_id`
WHERE `product`.`id` IS NULL;

ALTER TABLE `catalog_products`
    MODIFY COLUMN `status_changed_at` DATETIME(6) NOT NULL AFTER `updated_at`,
    DROP CHECK `ck_catalog_products_status`,
    DROP CHECK `ck_catalog_products_version`,
    DROP CHECK `ck_catalog_products_lifecycle`,
    DROP CHECK `ck_catalog_products_timestamp_order`,
    ADD CONSTRAINT `ck_catalog_products_status`
        CHECK (BINARY `status` IN (_binary'DRAFT', _binary'ACTIVE', _binary'SUSPENDED', _binary'ARCHIVED')),
    ADD CONSTRAINT `ck_catalog_products_version`
        CHECK (`version` >= 1),
    ADD CONSTRAINT `ck_catalog_products_lifecycle`
        CHECK (
            (
                `status` = _ascii'DRAFT'
                AND `activated_at` IS NULL
                AND `archived_at` IS NULL
                AND `status_changed_at` = `created_at`
                AND (`version` > 1 OR `updated_at` = `created_at`)
            )
            OR (
                `status` = _ascii'ACTIVE'
                AND `activated_at` IS NOT NULL
                AND `archived_at` IS NULL
                AND `activated_at` <= `status_changed_at`
                AND (
                    (
                        `activated_at` = `status_changed_at`
                        AND `version` >= 2
                        AND (`version` > 2 OR `updated_at` = `status_changed_at`)
                    )
                    OR (
                        `activated_at` < `status_changed_at`
                        AND `version` >= 4
                        AND (`version` > 4 OR `updated_at` = `status_changed_at`)
                    )
                )
            )
            OR (
                `status` = _ascii'SUSPENDED'
                AND `activated_at` IS NOT NULL
                AND `archived_at` IS NULL
                AND `activated_at` <= `status_changed_at`
                AND `version` >= 3
                AND (`version` > 3 OR `updated_at` = `status_changed_at`)
            )
            OR (
                `status` = _ascii'ARCHIVED'
                AND `archived_at` IS NOT NULL
                AND `archived_at` = `status_changed_at`
                AND `archived_at` = `updated_at`
                AND (
                    (`activated_at` IS NULL AND `version` >= 2)
                    OR (`activated_at` IS NOT NULL AND `version` >= 3)
                )
            )
        ),
    ADD CONSTRAINT `ck_catalog_products_timestamp_order`
        CHECK (
            `updated_at` >= `created_at`
            AND `status_changed_at` >= `created_at`
            AND `status_changed_at` <= `updated_at`
            AND (`activated_at` IS NULL OR (`activated_at` >= `created_at` AND `activated_at` <= `updated_at`))
            AND (
                `archived_at` IS NULL
                OR (
                    `archived_at` >= COALESCE(`activated_at`, `created_at`)
                    AND `archived_at` <= `updated_at`
                )
            )
        ),
    ALGORITHM=COPY,
    LOCK=SHARED;

ALTER TABLE `catalog_skus`
    MODIFY COLUMN `status_changed_at` DATETIME(6) NOT NULL AFTER `updated_at`,
    DROP CHECK `ck_catalog_skus_status`,
    DROP CHECK `ck_catalog_skus_version`,
    DROP CHECK `ck_catalog_skus_lifecycle`,
    DROP CHECK `ck_catalog_skus_timestamp_order`,
    ADD CONSTRAINT `ck_catalog_skus_status`
        CHECK (BINARY `status` IN (_binary'DRAFT', _binary'ACTIVE', _binary'SUSPENDED', _binary'RETIRED')),
    ADD CONSTRAINT `ck_catalog_skus_version`
        CHECK (`version` >= 1),
    ADD CONSTRAINT `ck_catalog_skus_lifecycle`
        CHECK (
            (
                `status` = _ascii'DRAFT'
                AND `activated_at` IS NULL
                AND `retired_at` IS NULL
                AND `status_changed_at` = `created_at`
                AND (`version` > 1 OR `updated_at` = `created_at`)
            )
            OR (
                `status` = _ascii'ACTIVE'
                AND `activated_at` IS NOT NULL
                AND `retired_at` IS NULL
                AND `activated_at` <= `status_changed_at`
                AND (
                    (
                        `activated_at` = `status_changed_at`
                        AND `version` >= 2
                        AND (`version` > 2 OR `updated_at` = `status_changed_at`)
                    )
                    OR (
                        `activated_at` < `status_changed_at`
                        AND `version` >= 4
                        AND (`version` > 4 OR `updated_at` = `status_changed_at`)
                    )
                )
            )
            OR (
                `status` = _ascii'SUSPENDED'
                AND `activated_at` IS NOT NULL
                AND `retired_at` IS NULL
                AND `activated_at` <= `status_changed_at`
                AND `version` >= 3
                AND (`version` > 3 OR `updated_at` = `status_changed_at`)
            )
            OR (
                `status` = _ascii'RETIRED'
                AND `retired_at` IS NOT NULL
                AND `retired_at` = `status_changed_at`
                AND `retired_at` = `updated_at`
                AND (
                    (`activated_at` IS NULL AND `version` >= 2)
                    OR (`activated_at` IS NOT NULL AND `version` >= 3)
                )
            )
        ),
    ADD CONSTRAINT `ck_catalog_skus_timestamp_order`
        CHECK (
            `updated_at` >= `created_at`
            AND `status_changed_at` >= `created_at`
            AND `status_changed_at` <= `updated_at`
            AND (`activated_at` IS NULL OR (`activated_at` >= `created_at` AND `activated_at` <= `updated_at`))
            AND (
                `retired_at` IS NULL
                OR (
                    `retired_at` >= COALESCE(`activated_at`, `created_at`)
                    AND `retired_at` <= `updated_at`
                )
            )
        ),
    ALGORITHM=COPY,
    LOCK=SHARED;

DROP TEMPORARY TABLE `_catalog_lifecycle_migration_guard`;
