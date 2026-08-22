ALTER TABLE `catalog_skus`
    DROP INDEX `ix_catalog_skus_public_traversal`,
    ADD INDEX `ix_catalog_skus_public_traversal` (`status` DESC, `created_at`, `id`);
