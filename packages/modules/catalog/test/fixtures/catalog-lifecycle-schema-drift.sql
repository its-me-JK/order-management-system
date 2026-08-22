-- The lifecycle migration does not recreate this invariant, so it must reject
-- a prior schema whose global SKU-code uniqueness has drifted.
ALTER TABLE `catalog_skus`
    DROP INDEX `uq_catalog_skus_code`;
