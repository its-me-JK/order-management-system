#!/usr/bin/env bash

set -euo pipefail

authority_test_database='oms_identity_authority_integration'
authority_test_database_grant='oms\_identity\_authority\_integration'
authority_test_setup_complete=0
authority_mysql_endpoint=''
authority_mysql_port=''
repository_directory="$(
  cd "$(dirname "${BASH_SOURCE[0]}")/../../../.."
  pwd
)"

cd "$repository_directory"
test -f pnpm-workspace.yaml
mkdir -p .local

exec {authority_integration_lock_fd}>.local/identity-authority-integration.lock
if ! flock --exclusive --nonblock "$authority_integration_lock_fd"; then
  printf '%s\n' 'Another Identity authority integration run owns the test database' >&2
  exit 2
fi

if [[ -n "${DATABASE_MIGRATION_URL:-}" ]]; then
  printf '%s\n' 'Refusing to run Identity authority tests while DATABASE_MIGRATION_URL is set' >&2
  exit 2
fi

if [[ -n "${DATABASE_SHADOW_URL:-}" ]]; then
  printf '%s\n' 'Refusing to run Identity authority tests while DATABASE_SHADOW_URL is set' >&2
  exit 2
fi

authority_mysql_endpoint="$(docker compose port mysql 3306)"
if [[ ! "$authority_mysql_endpoint" =~ ^127\.0\.0\.1:([1-9][0-9]{0,4})$ ]]; then
  printf '%s\n' 'Identity authority tests require a loopback Compose MySQL port' >&2
  exit 2
fi
authority_mysql_port=${BASH_REMATCH[1]}

create_authority_test_database() {
  docker compose exec -T \
    -e AUTHORITY_TEST_DATABASE="$authority_test_database" \
    -e AUTHORITY_TEST_DATABASE_GRANT="$authority_test_database_grant" \
    mysql sh -euc '
      case "$MYSQL_USER" in
        "" | *[!a-zA-Z0-9_]*)
          printf "%s\n" "MYSQL_USER must contain only letters, digits, and underscores" >&2
          exit 2
          ;;
      esac

      if [ "$AUTHORITY_TEST_DATABASE" != "oms_identity_authority_integration" ]; then
        printf "%s\n" "Unexpected Identity authority database" >&2
        exit 2
      fi

      MYSQL_PWD="$(cat /run/secrets/mysql_root_password)"
      export MYSQL_PWD

      mysql --protocol=TCP --host=127.0.0.1 --user=root <<EOSQL
DROP DATABASE IF EXISTS \`$AUTHORITY_TEST_DATABASE\`;
CREATE DATABASE \`$AUTHORITY_TEST_DATABASE\`
  CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON \`$AUTHORITY_TEST_DATABASE_GRANT\`.* TO '\''$MYSQL_USER'\''@'\''%'\'';
EOSQL
    '
}

drop_authority_test_database() {
  docker compose exec -T \
    -e AUTHORITY_TEST_DATABASE="$authority_test_database" \
    -e AUTHORITY_TEST_DATABASE_GRANT="$authority_test_database_grant" \
    mysql sh -euc '
      case "$MYSQL_USER" in
        "" | *[!a-zA-Z0-9_]*)
          printf "%s\n" "MYSQL_USER must contain only letters, digits, and underscores" >&2
          exit 2
          ;;
      esac

      if [ "$AUTHORITY_TEST_DATABASE" != "oms_identity_authority_integration" ]; then
        printf "%s\n" "Unexpected Identity authority database" >&2
        exit 2
      fi

      MYSQL_PWD="$(cat /run/secrets/mysql_root_password)"
      export MYSQL_PWD
      cleanup_failed=0

      if ! mysql --protocol=TCP --host=127.0.0.1 --user=root <<EOSQL
DROP DATABASE IF EXISTS \`$AUTHORITY_TEST_DATABASE\`;
EOSQL
      then
        cleanup_failed=1
      fi

      if ! mysql --protocol=TCP --host=127.0.0.1 --user=root <<EOSQL
REVOKE SELECT, INSERT, UPDATE, DELETE
  ON \`$AUTHORITY_TEST_DATABASE_GRANT\`.* FROM '\''$MYSQL_USER'\''@'\''%'\'';
EOSQL
      then
        cleanup_failed=1
      fi

      exit "$cleanup_failed"
    '
}

cleanup_authority_test_database() {
  authority_test_status=$?
  trap - EXIT

  if [[ "$authority_test_setup_complete" -eq 1 ]] && ! drop_authority_test_database; then
    if [[ "$authority_test_status" -eq 0 ]]; then
      authority_test_status=1
    fi
  fi

  exit "$authority_test_status"
}

trap cleanup_authority_test_database EXIT

authority_test_setup_complete=1
create_authority_test_database

unset DATABASE_PASSWORD

export IDENTITY_AUTHORITY_INTEGRATION_CONFIRM_DATABASE="$authority_test_database"
export DATABASE_HOST='127.0.0.1'
export DATABASE_MIGRATION_URL=''
export DATABASE_NAME="$authority_test_database"
export DATABASE_PORT="$authority_mysql_port"
export DATABASE_TLS_MODE='disabled'

pnpm db:migrate:deploy
pnpm db:migrate:deploy
pnpm --filter @oms/identity run test:integration:authority
