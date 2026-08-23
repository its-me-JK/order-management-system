#!/usr/bin/env bash

set -euo pipefail

refresh_discovery_test_database='oms_identity_refresh_discovery_integration'
refresh_discovery_test_database_grant='oms\_identity\_refresh\_discovery\_integration'
refresh_discovery_test_setup_complete=0
refresh_discovery_mysql_endpoint=''
refresh_discovery_mysql_port=''
repository_directory="$(
  cd "$(dirname "${BASH_SOURCE[0]}")/../../../.."
  pwd
)"

cd "$repository_directory"
test -f pnpm-workspace.yaml
mkdir -p .local

exec {refresh_discovery_integration_lock_fd}>.local/identity-refresh-discovery-integration.lock
if ! flock --exclusive --nonblock "$refresh_discovery_integration_lock_fd"; then
  printf '%s\n' 'Another Identity refresh-discovery integration run owns the test database' >&2
  exit 2
fi

if [[ -n "${DATABASE_MIGRATION_URL:-}" ]]; then
  printf '%s\n' 'Refusing to run Identity refresh-discovery tests while DATABASE_MIGRATION_URL is set' >&2
  exit 2
fi

if [[ -n "${DATABASE_SHADOW_URL:-}" ]]; then
  printf '%s\n' 'Refusing to run Identity refresh-discovery tests while DATABASE_SHADOW_URL is set' >&2
  exit 2
fi

refresh_discovery_mysql_endpoint="$(docker compose port mysql 3306)"
if [[ ! "$refresh_discovery_mysql_endpoint" =~ ^127\.0\.0\.1:([1-9][0-9]{0,4})$ ]]; then
  printf '%s\n' 'Identity refresh-discovery tests require a loopback Compose MySQL port' >&2
  exit 2
fi
refresh_discovery_mysql_port=${BASH_REMATCH[1]}

create_refresh_discovery_test_database() {
  docker compose exec -T \
    -e REFRESH_DISCOVERY_TEST_DATABASE="$refresh_discovery_test_database" \
    -e REFRESH_DISCOVERY_TEST_DATABASE_GRANT="$refresh_discovery_test_database_grant" \
    mysql sh -euc '
      case "$MYSQL_USER" in
        "" | *[!a-zA-Z0-9_]*)
          printf "%s\n" "MYSQL_USER must contain only letters, digits, and underscores" >&2
          exit 2
          ;;
      esac

      if [ "$REFRESH_DISCOVERY_TEST_DATABASE" != "oms_identity_refresh_discovery_integration" ]; then
        printf "%s\n" "Unexpected Identity refresh-discovery database" >&2
        exit 2
      fi

      MYSQL_PWD="$(cat /run/secrets/mysql_root_password)"
      export MYSQL_PWD

      mysql --protocol=TCP --host=127.0.0.1 --user=root <<EOSQL
DROP DATABASE IF EXISTS \`$REFRESH_DISCOVERY_TEST_DATABASE\`;
CREATE DATABASE \`$REFRESH_DISCOVERY_TEST_DATABASE\`
  CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON \`$REFRESH_DISCOVERY_TEST_DATABASE_GRANT\`.* TO '\''$MYSQL_USER'\''@'\''%'\'';
EOSQL
    '
}

drop_refresh_discovery_test_database() {
  docker compose exec -T \
    -e REFRESH_DISCOVERY_TEST_DATABASE="$refresh_discovery_test_database" \
    -e REFRESH_DISCOVERY_TEST_DATABASE_GRANT="$refresh_discovery_test_database_grant" \
    mysql sh -euc '
      case "$MYSQL_USER" in
        "" | *[!a-zA-Z0-9_]*)
          printf "%s\n" "MYSQL_USER must contain only letters, digits, and underscores" >&2
          exit 2
          ;;
      esac

      if [ "$REFRESH_DISCOVERY_TEST_DATABASE" != "oms_identity_refresh_discovery_integration" ]; then
        printf "%s\n" "Unexpected Identity refresh-discovery database" >&2
        exit 2
      fi

      MYSQL_PWD="$(cat /run/secrets/mysql_root_password)"
      export MYSQL_PWD
      cleanup_failed=0

      if ! mysql --protocol=TCP --host=127.0.0.1 --user=root <<EOSQL
DROP DATABASE IF EXISTS \`$REFRESH_DISCOVERY_TEST_DATABASE\`;
EOSQL
      then
        cleanup_failed=1
      fi

      if ! mysql --protocol=TCP --host=127.0.0.1 --user=root <<EOSQL
REVOKE SELECT, INSERT, UPDATE, DELETE
  ON \`$REFRESH_DISCOVERY_TEST_DATABASE_GRANT\`.* FROM '\''$MYSQL_USER'\''@'\''%'\'';
EOSQL
      then
        cleanup_failed=1
      fi

      exit "$cleanup_failed"
    '
}

cleanup_refresh_discovery_test_database() {
  refresh_discovery_test_status=$?
  trap - EXIT

  if [[ "$refresh_discovery_test_setup_complete" -eq 1 ]] &&
    ! drop_refresh_discovery_test_database; then
    if [[ "$refresh_discovery_test_status" -eq 0 ]]; then
      refresh_discovery_test_status=1
    fi
  fi

  exit "$refresh_discovery_test_status"
}

trap cleanup_refresh_discovery_test_database EXIT

refresh_discovery_test_setup_complete=1
create_refresh_discovery_test_database

unset DATABASE_PASSWORD

export IDENTITY_REFRESH_DISCOVERY_INTEGRATION_CONFIRM_DATABASE="$refresh_discovery_test_database"
export DATABASE_HOST='127.0.0.1'
export DATABASE_MIGRATION_URL=''
export DATABASE_NAME="$refresh_discovery_test_database"
export DATABASE_PORT="$refresh_discovery_mysql_port"
export DATABASE_TLS_MODE='disabled'

pnpm db:migrate:deploy
pnpm db:migrate:deploy
pnpm --filter @oms/identity run test:integration:refresh-discovery
