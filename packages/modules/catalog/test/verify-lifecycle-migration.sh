#!/usr/bin/env bash

set -euo pipefail

valid_upgrade_database='oms_catalog_upgrade_integration'
invalid_upgrade_database='oms_catalog_invalid_upgrade_integration'
partial_upgrade_database='oms_catalog_partial_upgrade_integration'
initial_migration='packages/database/prisma/migrations/20260822145724_create_catalog/migration.sql'
lifecycle_migration='packages/database/prisma/migrations/20260823120000_expand_catalog_lifecycle/migration.sql'
valid_fixture='packages/modules/catalog/test/fixtures/catalog-lifecycle-valid-legacy.sql'
valid_assertions='packages/modules/catalog/test/fixtures/catalog-lifecycle-upgrade-assertions.sql'
invalid_product_fixture='packages/modules/catalog/test/fixtures/catalog-lifecycle-invalid-product-legacy.sql'
invalid_sku_fixture='packages/modules/catalog/test/fixtures/catalog-lifecycle-invalid-sku-legacy.sql'
schema_drift_fixture='packages/modules/catalog/test/fixtures/catalog-lifecycle-schema-drift.sql'
index_direction_drift_fixture='packages/modules/catalog/test/fixtures/catalog-lifecycle-index-direction-drift.sql'
trigger_drift_fixture='packages/modules/catalog/test/fixtures/catalog-lifecycle-trigger-drift.sql'
orphan_sku_fixture='packages/modules/catalog/test/fixtures/catalog-lifecycle-orphan-sku.sql'
oversized_product_fixture='packages/modules/catalog/test/fixtures/catalog-lifecycle-oversized-product-legacy.sql'
oversized_sku_fixture='packages/modules/catalog/test/fixtures/catalog-lifecycle-oversized-sku-legacy.sql'
partial_expand_fixture='packages/modules/catalog/test/fixtures/catalog-lifecycle-partial-product-expand.sql'
catalog_mysql_endpoint=''
catalog_mysql_port=''
repository_directory="$(
  cd "$(dirname "${BASH_SOURCE[0]}")/../../../.."
  pwd
)"

cd "$repository_directory"
test -f pnpm-workspace.yaml
test -f "$initial_migration"
test -f "$lifecycle_migration"
test -f "$valid_fixture"
test -f "$valid_assertions"
test -f "$invalid_product_fixture"
test -f "$invalid_sku_fixture"
test -f "$schema_drift_fixture"
test -f "$index_direction_drift_fixture"
test -f "$trigger_drift_fixture"
test -f "$orphan_sku_fixture"
test -f "$oversized_product_fixture"
test -f "$oversized_sku_fixture"
test -f "$partial_expand_fixture"

mkdir -p .local
exec {catalog_lifecycle_migration_lock_fd}>.local/catalog-lifecycle-migration.lock
if ! flock --exclusive --nonblock "$catalog_lifecycle_migration_lock_fd"; then
  printf '%s\n' 'Another Catalog lifecycle migration verification is running' >&2
  exit 2
fi

if [[ -n "${DATABASE_MIGRATION_URL:-}" ]]; then
  printf '%s\n' 'Refusing to verify Catalog migration while DATABASE_MIGRATION_URL is set' >&2
  exit 2
fi

catalog_mysql_endpoint="$(docker compose port mysql 3306)"
if [[ ! "$catalog_mysql_endpoint" =~ ^127\.0\.0\.1:([1-9][0-9]{0,4})$ ]]; then
  printf '%s\n' 'Catalog migration verification requires a loopback MySQL port' >&2
  exit 2
fi
catalog_mysql_port=${BASH_REMATCH[1]}

run_root_sql() {
  local catalog_upgrade_database=$1

  case "$catalog_upgrade_database" in
    "$valid_upgrade_database" | "$invalid_upgrade_database" | "$partial_upgrade_database") ;;
    *)
      printf '%s\n' 'Refusing to use an unexpected Catalog upgrade test database' >&2
      return 2
      ;;
  esac

  docker compose exec -T \
    -e CATALOG_UPGRADE_DATABASE="$catalog_upgrade_database" \
    mysql sh -euc '
      MYSQL_PWD="$(cat /run/secrets/mysql_root_password)"
      export MYSQL_PWD

      exec mysql \
        --protocol=TCP \
        --host=127.0.0.1 \
        --user=root \
        --database="$CATALOG_UPGRADE_DATABASE" \
        --batch \
        --raw \
        --skip-column-names
    '
}

run_root_admin_sql() {
  docker compose exec -T mysql sh -euc '
    MYSQL_PWD="$(cat /run/secrets/mysql_root_password)"
    export MYSQL_PWD

    exec mysql \
      --protocol=TCP \
      --host=127.0.0.1 \
      --user=root \
      --batch \
      --raw \
      --skip-column-names
  '
}

reset_upgrade_databases() {
  printf '%s\n' \
    'DROP DATABASE IF EXISTS `oms_catalog_upgrade_integration`;' \
    'DROP DATABASE IF EXISTS `oms_catalog_invalid_upgrade_integration`;' \
    'DROP DATABASE IF EXISTS `oms_catalog_partial_upgrade_integration`;' \
    'CREATE DATABASE `oms_catalog_upgrade_integration` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;' \
    'CREATE DATABASE `oms_catalog_invalid_upgrade_integration` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;' \
    'CREATE DATABASE `oms_catalog_partial_upgrade_integration` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;' \
    | run_root_admin_sql
}

reset_invalid_upgrade_database() {
  printf '%s\n' \
    'DROP DATABASE IF EXISTS `oms_catalog_invalid_upgrade_integration`;' \
    'CREATE DATABASE `oms_catalog_invalid_upgrade_integration` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;' \
    | run_root_admin_sql
}

drop_upgrade_databases() {
  printf '%s\n' \
    'DROP DATABASE IF EXISTS `oms_catalog_upgrade_integration`;' \
    'DROP DATABASE IF EXISTS `oms_catalog_invalid_upgrade_integration`;' \
    'DROP DATABASE IF EXISTS `oms_catalog_partial_upgrade_integration`;' \
    | run_root_admin_sql
}

cleanup_upgrade_databases() {
  upgrade_test_status=$?
  trap - EXIT

  if ! drop_upgrade_databases && [[ "$upgrade_test_status" -eq 0 ]]; then
    upgrade_test_status=1
  fi

  exit "$upgrade_test_status"
}

trap cleanup_upgrade_databases EXIT

reset_upgrade_databases

run_root_sql "$valid_upgrade_database" < "$initial_migration"
run_root_sql "$valid_upgrade_database" < "$valid_fixture"
DATABASE_HOST='127.0.0.1' \
  DATABASE_MIGRATION_URL='' \
  DATABASE_NAME="$valid_upgrade_database" \
  DATABASE_PORT="$catalog_mysql_port" \
  pnpm db:migrate:deploy
run_root_sql "$valid_upgrade_database" < "$valid_assertions"

assert_preflight_rejected() {
  local rejected_fixture=$1
  local success_message=$2
  local invalid_migration_error
  local invalid_upgrade_column_count

  reset_invalid_upgrade_database
  run_root_sql "$invalid_upgrade_database" < "$initial_migration"
  run_root_sql "$invalid_upgrade_database" < "$rejected_fixture"

  if invalid_migration_error="$(
    run_root_sql "$invalid_upgrade_database" < "$lifecycle_migration" 2>&1 >/dev/null
  )"; then
    printf '%s\n' 'Catalog lifecycle migration accepted a rejected prior state' >&2
    return 1
  fi

  if [[ "$invalid_migration_error" != *'ck_catalog_lifecycle_migration_guard'* ]]; then
    printf '%s\n' 'Catalog lifecycle migration failed outside the expected preflight guard' >&2
    return 1
  fi

  invalid_upgrade_column_count="$({
    printf '%s\n' \
      "SELECT COUNT(*)" \
      "FROM information_schema.COLUMNS" \
      "WHERE TABLE_SCHEMA = DATABASE()" \
      "  AND TABLE_NAME IN (_utf8mb4'catalog_products', _utf8mb4'catalog_skus')" \
      "  AND COLUMN_NAME = _utf8mb4'status_changed_at';"
  } | run_root_sql "$invalid_upgrade_database")"

  if [[ "$invalid_upgrade_column_count" != '0' ]]; then
    printf '%s\n' 'Catalog lifecycle preflight changed an invalid legacy schema' >&2
    return 1
  fi

  printf '%s\n' "$success_message"
}

assert_preflight_rejected \
  "$invalid_product_fixture" \
  'Catalog Product invalid-history preflight verified'
assert_preflight_rejected \
  "$invalid_sku_fixture" \
  'Catalog SKU invalid-history preflight verified'
assert_preflight_rejected \
  "$schema_drift_fixture" \
  'Catalog prior-schema drift preflight verified'
assert_preflight_rejected \
  "$index_direction_drift_fixture" \
  'Catalog index-direction drift preflight verified'
assert_preflight_rejected \
  "$trigger_drift_fixture" \
  'Catalog trigger drift preflight verified'
assert_preflight_rejected \
  "$orphan_sku_fixture" \
  'Catalog orphaned-SKU preflight verified'
assert_preflight_rejected \
  "$oversized_product_fixture" \
  'Catalog Product bounded-row preflight verified'
assert_preflight_rejected \
  "$oversized_sku_fixture" \
  'Catalog SKU bounded-row preflight verified'

run_root_sql "$partial_upgrade_database" < "$initial_migration"
run_root_sql "$partial_upgrade_database" < "$partial_expand_fixture"

if partial_migration_error="$(
  run_root_sql "$partial_upgrade_database" < "$lifecycle_migration" 2>&1 >/dev/null
)"; then
  printf '%s\n' 'Catalog lifecycle migration accepted a partial expansion state' >&2
  exit 1
fi

if [[ "$partial_migration_error" != *'ck_catalog_lifecycle_migration_guard'* ]]; then
  printf '%s\n' 'Catalog partial-state migration failed outside the expected preflight guard' >&2
  exit 1
fi

partial_state_descriptor="$({
  printf '%s\n' \
    "SELECT CONCAT(" \
    "  (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = _utf8mb4'catalog_products' AND COLUMN_NAME = _utf8mb4'status_changed_at' AND COLUMN_TYPE = _utf8mb4'datetime(6)' AND IS_NULLABLE = _utf8mb4'YES')," \
    "  _ascii'|'," \
    "  (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = _utf8mb4'catalog_skus' AND COLUMN_NAME = _utf8mb4'status_changed_at')," \
    "  _ascii'|'," \
    "  (SELECT COUNT(*) FROM catalog_products WHERE status_changed_at IS NOT NULL OR version <> 1)" \
    ");"
} | run_root_sql "$partial_upgrade_database")"

if [[ "$partial_state_descriptor" != '1|0|0' ]]; then
  printf '%s\n' 'Catalog lifecycle preflight mutated a partial expansion state' >&2
  exit 1
fi

# This is the only lossless rollback path: the additive column is nullable,
# entirely empty, and no later phase ran. Every state containing backfilled data
# is recovered by a reviewed roll-forward as documented in the runbook.
printf '%s\n' \
  'ALTER TABLE `catalog_products` DROP COLUMN `status_changed_at`, ALGORITHM=INSTANT;' \
  | run_root_sql "$partial_upgrade_database"
run_root_sql "$partial_upgrade_database" < "$lifecycle_migration"

partial_recovery_descriptor="$({
  printf '%s\n' \
    "SELECT CONCAT(" \
    "  (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (_utf8mb4'catalog_products', _utf8mb4'catalog_skus') AND COLUMN_NAME = _utf8mb4'status_changed_at' AND COLUMN_TYPE = _utf8mb4'datetime(6)' AND IS_NULLABLE = _utf8mb4'NO')," \
    "  _ascii'|'," \
    "  (SELECT COUNT(*) FROM catalog_products WHERE status_changed_at <> created_at OR version <> 1)" \
    ");"
} | run_root_sql "$partial_upgrade_database")"

if [[ "$partial_recovery_descriptor" != '2|0' ]]; then
  printf '%s\n' 'Catalog lifecycle partial expansion did not recover to the final contract' >&2
  exit 1
fi

printf '%s\n' 'Catalog lifecycle partial-expansion recovery verified'
