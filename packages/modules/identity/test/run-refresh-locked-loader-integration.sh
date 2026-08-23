#!/usr/bin/env bash

set -euo pipefail

refresh_locked_loader_test_database='oms_identity_refresh_locked_loader_integration'
refresh_locked_loader_test_database_grant='oms\_identity\_refresh\_locked\_loader\_integration'
refresh_locked_loader_test_setup_complete=0
refresh_locked_loader_mysql_endpoint=''
refresh_locked_loader_mysql_port=''
repository_directory="$(
  cd "$(dirname "${BASH_SOURCE[0]}")/../../../.."
  pwd
)"

cd "$repository_directory"
test -f pnpm-workspace.yaml
mkdir -p .local

exec {refresh_locked_loader_integration_lock_fd}>.local/identity-refresh-locked-loader-integration.lock
if ! flock --exclusive --nonblock "$refresh_locked_loader_integration_lock_fd"; then
  printf '%s\n' 'Another Identity refresh locked-loader integration run owns the test database' >&2
  exit 2
fi

if [[ -n "${DATABASE_MIGRATION_URL:-}" ]]; then
  printf '%s\n' 'Refusing to run Identity refresh locked-loader tests while DATABASE_MIGRATION_URL is set' >&2
  exit 2
fi

if [[ -n "${DATABASE_SHADOW_URL:-}" ]]; then
  printf '%s\n' 'Refusing to run Identity refresh locked-loader tests while DATABASE_SHADOW_URL is set' >&2
  exit 2
fi

refresh_locked_loader_mysql_endpoint="$(docker compose port mysql 3306)"
if [[ ! "$refresh_locked_loader_mysql_endpoint" =~ ^127\.0\.0\.1:([1-9][0-9]{0,4})$ ]]; then
  printf '%s\n' 'Identity refresh locked-loader tests require a loopback Compose MySQL port' >&2
  exit 2
fi
refresh_locked_loader_mysql_port=${BASH_REMATCH[1]}

create_refresh_locked_loader_test_database() {
  docker compose exec -T \
    -e REFRESH_LOCKED_LOADER_TEST_DATABASE="$refresh_locked_loader_test_database" \
    -e REFRESH_LOCKED_LOADER_TEST_DATABASE_GRANT="$refresh_locked_loader_test_database_grant" \
    mysql sh -euc '
      case "$MYSQL_USER" in
        "" | *[!a-zA-Z0-9_]*)
          printf "%s\n" "MYSQL_USER must contain only letters, digits, and underscores" >&2
          exit 2
          ;;
      esac

      if [ "$REFRESH_LOCKED_LOADER_TEST_DATABASE" != "oms_identity_refresh_locked_loader_integration" ]; then
        printf "%s\n" "Unexpected Identity refresh locked-loader database" >&2
        exit 2
      fi

      MYSQL_PWD="$(cat /run/secrets/mysql_root_password)"
      export MYSQL_PWD

      mysql --protocol=TCP --host=127.0.0.1 --user=root <<EOSQL
DROP DATABASE IF EXISTS \`$REFRESH_LOCKED_LOADER_TEST_DATABASE\`;
CREATE DATABASE \`$REFRESH_LOCKED_LOADER_TEST_DATABASE\`
  CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON \`$REFRESH_LOCKED_LOADER_TEST_DATABASE_GRANT\`.* TO '\''$MYSQL_USER'\''@'\''%'\'';
EOSQL
    '
}

drop_refresh_locked_loader_test_database() {
  docker compose exec -T \
    -e REFRESH_LOCKED_LOADER_TEST_DATABASE="$refresh_locked_loader_test_database" \
    -e REFRESH_LOCKED_LOADER_TEST_DATABASE_GRANT="$refresh_locked_loader_test_database_grant" \
    mysql sh -euc '
      case "$MYSQL_USER" in
        "" | *[!a-zA-Z0-9_]*)
          printf "%s\n" "MYSQL_USER must contain only letters, digits, and underscores" >&2
          exit 2
          ;;
      esac

      if [ "$REFRESH_LOCKED_LOADER_TEST_DATABASE" != "oms_identity_refresh_locked_loader_integration" ]; then
        printf "%s\n" "Unexpected Identity refresh locked-loader database" >&2
        exit 2
      fi

      MYSQL_PWD="$(cat /run/secrets/mysql_root_password)"
      export MYSQL_PWD
      cleanup_failed=0

      if ! mysql --protocol=TCP --host=127.0.0.1 --user=root <<EOSQL
DROP DATABASE IF EXISTS \`$REFRESH_LOCKED_LOADER_TEST_DATABASE\`;
EOSQL
      then
        cleanup_failed=1
      fi

      if ! mysql --protocol=TCP --host=127.0.0.1 --user=root <<EOSQL
REVOKE SELECT, INSERT, UPDATE, DELETE
  ON \`$REFRESH_LOCKED_LOADER_TEST_DATABASE_GRANT\`.* FROM '\''$MYSQL_USER'\''@'\''%'\'';
EOSQL
      then
        cleanup_failed=1
      fi

      database_count="$(
        mysql --batch --skip-column-names --protocol=TCP --host=127.0.0.1 --user=root \
          --execute="SELECT COUNT(*) FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = '\''$REFRESH_LOCKED_LOADER_TEST_DATABASE'\'';"
      )"
      if [ "$database_count" != "0" ]; then
        printf "%s\n" "Identity refresh locked-loader database cleanup was incomplete" >&2
        cleanup_failed=1
      fi

      if cleanup_grants="$(
        mysql --batch --skip-column-names --protocol=TCP --host=127.0.0.1 --user=root \
          --execute="SHOW GRANTS FOR '\''$MYSQL_USER'\''@'\''%'\'';"
      )"; then
        case "$cleanup_grants" in
          *"\`$REFRESH_LOCKED_LOADER_TEST_DATABASE_GRANT\`."*)
            printf "%s\n" "Identity refresh locked-loader grant cleanup was incomplete" >&2
            cleanup_failed=1
            ;;
        esac
      else
        printf "%s\n" "Identity refresh locked-loader grant cleanup verification failed" >&2
        cleanup_failed=1
      fi
      unset cleanup_grants

      exit "$cleanup_failed"
    '
}

cleanup_refresh_locked_loader_test_database() {
  refresh_locked_loader_test_status=$?
  trap - EXIT

  if [[ "$refresh_locked_loader_test_setup_complete" -eq 1 ]] &&
    ! drop_refresh_locked_loader_test_database; then
    if [[ "$refresh_locked_loader_test_status" -eq 0 ]]; then
      refresh_locked_loader_test_status=1
    fi
  fi

  exit "$refresh_locked_loader_test_status"
}

trap cleanup_refresh_locked_loader_test_database EXIT

refresh_locked_loader_test_setup_complete=1
create_refresh_locked_loader_test_database

unset DATABASE_PASSWORD

export IDENTITY_REFRESH_LOCKED_LOADER_INTEGRATION_CONFIRM_DATABASE="$refresh_locked_loader_test_database"
export DATABASE_CONNECTION_LIMIT='5'
export DATABASE_HOST='127.0.0.1'
export DATABASE_MIGRATION_URL=''
export DATABASE_NAME="$refresh_locked_loader_test_database"
export DATABASE_PORT="$refresh_locked_loader_mysql_port"
export DATABASE_TLS_MODE='disabled'

pnpm db:migrate:deploy
pnpm db:migrate:deploy
pnpm --filter @oms/identity run test:integration:refresh-locked-loader
