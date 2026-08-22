#!/usr/bin/env bash

set -euo pipefail

catalog_test_database='oms_catalog_integration'
catalog_test_database_grant='oms\_catalog\_integration'
catalog_test_setup_complete=0
repository_directory="$(
  cd "$(dirname "${BASH_SOURCE[0]}")/../../../.."
  pwd
)"

cd "$repository_directory"
test -f pnpm-workspace.yaml
mkdir -p .local

exec {catalog_integration_lock_fd}>.local/catalog-integration.lock
if ! flock --exclusive --nonblock "$catalog_integration_lock_fd"; then
  printf '%s\n' 'Another Catalog integration run owns the local test database' >&2
  exit 2
fi

if [[ -n "${DATABASE_MIGRATION_URL:-}" ]]; then
  printf '%s\n' 'Refusing to run Catalog integration tests while DATABASE_MIGRATION_URL is set' >&2
  exit 2
fi

create_catalog_test_database() {
  docker compose exec -T \
    -e CATALOG_TEST_DATABASE="$catalog_test_database" \
    -e CATALOG_TEST_DATABASE_GRANT="$catalog_test_database_grant" \
    mysql sh -euc '
      case "$MYSQL_USER" in
        "" | *[!a-zA-Z0-9_]*)
          printf "%s\n" "MYSQL_USER must contain only letters, digits, and underscores" >&2
          exit 2
          ;;
      esac

      MYSQL_PWD="$(cat /run/secrets/mysql_root_password)"
      export MYSQL_PWD

      mysql --protocol=TCP --host=127.0.0.1 --user=root <<EOSQL
DROP DATABASE IF EXISTS \`$CATALOG_TEST_DATABASE\`;
CREATE DATABASE \`$CATALOG_TEST_DATABASE\`
  CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON \`$CATALOG_TEST_DATABASE_GRANT\`.* TO '\''$MYSQL_USER'\''@'\''%'\'';
EOSQL
    '
}

drop_catalog_test_database() {
  docker compose exec -T \
    -e CATALOG_TEST_DATABASE="$catalog_test_database" \
    -e CATALOG_TEST_DATABASE_GRANT="$catalog_test_database_grant" \
    mysql sh -euc '
      case "$MYSQL_USER" in
        "" | *[!a-zA-Z0-9_]*)
          printf "%s\n" "MYSQL_USER must contain only letters, digits, and underscores" >&2
          exit 2
          ;;
      esac

      MYSQL_PWD="$(cat /run/secrets/mysql_root_password)"
      export MYSQL_PWD
      cleanup_failed=0

      if ! mysql --protocol=TCP --host=127.0.0.1 --user=root <<EOSQL
DROP DATABASE IF EXISTS \`$CATALOG_TEST_DATABASE\`;
EOSQL
      then
        cleanup_failed=1
      fi

      if ! mysql --protocol=TCP --host=127.0.0.1 --user=root <<EOSQL
REVOKE SELECT, INSERT, UPDATE, DELETE
  ON \`$CATALOG_TEST_DATABASE_GRANT\`.* FROM '\''$MYSQL_USER'\''@'\''%'\'';
EOSQL
      then
        cleanup_failed=1
      fi

      exit "$cleanup_failed"
    '
}

cleanup_catalog_test_database() {
  catalog_test_status=$?
  trap - EXIT

  if [[ "$catalog_test_setup_complete" -eq 1 ]] && ! drop_catalog_test_database; then
    if [[ "$catalog_test_status" -eq 0 ]]; then
      catalog_test_status=1
    fi
  fi

  exit "$catalog_test_status"
}

trap cleanup_catalog_test_database EXIT

catalog_test_setup_complete=1
create_catalog_test_database

unset DATABASE_PASSWORD

export CATALOG_INTEGRATION_CONFIRM_DATABASE="$catalog_test_database"
export DATABASE_HOST='127.0.0.1'
export DATABASE_MIGRATION_URL=''
export DATABASE_NAME="$catalog_test_database"
export DATABASE_TLS_MODE='disabled'

pnpm db:migrate:deploy
pnpm db:migrate:deploy
pnpm --filter @oms/catalog run test:integration
pnpm --filter @oms/api run test:integration:catalog
