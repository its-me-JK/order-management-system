-- Any trigger is outside the module-owned migration contract. In particular,
-- update triggers would execute once per row during lifecycle backfill.
CREATE TRIGGER `trg_catalog_products_unexpected_update`
BEFORE UPDATE ON `catalog_products`
FOR EACH ROW
SET NEW.`name` = CONCAT(NEW.`name`, _utf8mb4' changed');
