#!/usr/bin/env bash

set -euo pipefail

authorization_test_database='oms_identity_authorization_integration'
authorization_shadow_database='oms_identity_authorization_shadow'
authorization_migration_name='20260823213000_create_identity_authorization_audit'
authorization_fixture='packages/database/test/fixtures/identity-authorization-valid.sql'
authorization_registry='packages/modules/identity/authorization.registry.json'
authorization_mysql_endpoint=''
authorization_mysql_port=''
repository_directory="$(
  cd "$(dirname "${BASH_SOURCE[0]}")/../../.."
  pwd
)"

cd "$repository_directory"
test -f pnpm-workspace.yaml
test -f "packages/database/prisma/migrations/$authorization_migration_name/migration.sql"
test -f "$authorization_fixture"
test -f "$authorization_registry"

mkdir -p .local
exec {authorization_migration_lock_fd}>.local/identity-authorization-migration.lock
if ! flock --exclusive --nonblock "$authorization_migration_lock_fd"; then
  printf '%s\n' 'Another Identity authorization migration verification is running' >&2
  exit 2
fi

if [[ -n "${DATABASE_MIGRATION_URL:-}" ]]; then
  printf '%s\n' 'Refusing to verify Identity authorization while DATABASE_MIGRATION_URL is set' >&2
  exit 2
fi

if [[ -n "${DATABASE_SHADOW_URL:-}" ]]; then
  printf '%s\n' 'Refusing to verify Identity authorization while DATABASE_SHADOW_URL is set' >&2
  exit 2
fi

authorization_mysql_endpoint="$(docker compose port mysql 3306)"
if [[ ! "$authorization_mysql_endpoint" =~ ^127\.0\.0\.1:([1-9][0-9]{0,4})$ ]]; then
  printf '%s\n' 'Identity authorization verification requires a loopback MySQL port' >&2
  exit 2
fi
authorization_mysql_port=${BASH_REMATCH[1]}

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

run_root_authorization_sql() {
  local requested_database=$1

  if [[ "$requested_database" != "$authorization_test_database" ]]; then
    printf '%s\n' 'Refusing to use an unexpected Identity authorization database' >&2
    return 2
  fi

  docker compose exec -T \
    -e AUTHORIZATION_TEST_DATABASE="$requested_database" \
    mysql sh -euc '
      if [ "$AUTHORIZATION_TEST_DATABASE" != "oms_identity_authorization_integration" ]; then
        printf "%s\n" "Unexpected Identity authorization database" >&2
        exit 2
      fi

      MYSQL_PWD="$(cat /run/secrets/mysql_root_password)"
      export MYSQL_PWD

      exec mysql \
        --protocol=TCP \
        --host=127.0.0.1 \
        --user=root \
        --database="$AUTHORIZATION_TEST_DATABASE" \
        --batch \
        --raw \
        --skip-column-names
    '
}

reset_authorization_databases() {
  printf '%s\n' \
    'DROP DATABASE IF EXISTS `oms_identity_authorization_integration`;' \
    'DROP DATABASE IF EXISTS `oms_identity_authorization_shadow`;' \
    'CREATE DATABASE `oms_identity_authorization_integration` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;' \
    'CREATE DATABASE `oms_identity_authorization_shadow` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;' \
    | run_root_admin_sql
}

drop_authorization_databases() {
  printf '%s\n' \
    'DROP DATABASE IF EXISTS `oms_identity_authorization_integration`;' \
    'DROP DATABASE IF EXISTS `oms_identity_authorization_shadow`;' \
    | run_root_admin_sql
}

resolve_shadow_database_url() {
  local root_password_file=${MYSQL_ROOT_PASSWORD_FILE:-.local/secrets/mysql-root-password}

  if [[ ! -f "$root_password_file" ]]; then
    printf '%s\n' 'Identity authorization verification cannot read the root password file' >&2
    return 2
  fi

  AUTHORIZATION_MYSQL_PORT="$authorization_mysql_port" \
    AUTHORIZATION_ROOT_PASSWORD_FILE="$root_password_file" \
    AUTHORIZATION_SHADOW_DATABASE="$authorization_shadow_database" \
    node -e '
      const { readFileSync } = require("node:fs");

      const password = readFileSync(process.env.AUTHORIZATION_ROOT_PASSWORD_FILE, "utf8").trim();
      if (password === "") {
        throw new Error("The Identity authorization root password file is empty");
      }

      const url = new URL("mysql://localhost");
      url.username = "root";
      url.password = password;
      url.hostname = "127.0.0.1";
      url.port = process.env.AUTHORIZATION_MYSQL_PORT;
      url.pathname = `/${process.env.AUTHORIZATION_SHADOW_DATABASE}`;
      process.stdout.write(url.toString());
    '
}

cleanup_authorization_databases() {
  local authorization_test_status=$?
  trap - EXIT

  if ! drop_authorization_databases && [[ "$authorization_test_status" -eq 0 ]]; then
    authorization_test_status=1
  fi

  exit "$authorization_test_status"
}

assert_sql_output() {
  local expected_output=$1
  local actual_output

  actual_output="$(run_root_authorization_sql "$authorization_test_database")"

  if [[ "$actual_output" != "$expected_output" ]]; then
    printf '%s\n' 'Unexpected Identity authorization assertion output' >&2
    printf 'expected: %s\n' "$expected_output" >&2
    printf 'actual:   %s\n' "$actual_output" >&2
    return 1
  fi
}

assert_sql_rejected() {
  local expected_constraint=$1
  local rejection_output

  if rejection_output="$(run_root_authorization_sql "$authorization_test_database" 2>&1)"; then
    printf '%s\n' "Identity authorization accepted a row that should violate $expected_constraint" >&2
    return 1
  fi

  if [[ "$rejection_output" != *"$expected_constraint"* ]]; then
    printf '%s\n' "Identity authorization rejected a row outside $expected_constraint" >&2
    printf '%s\n' "$rejection_output" >&2
    return 1
  fi
}

authorization_registry_expected="$({
  AUTHORIZATION_REGISTRY="$authorization_registry" node <<'NODE'
const { readFileSync } = require('node:fs');

const fail = () => {
  throw new Error('Invalid Identity authorization registry');
};
const registry = JSON.parse(readFileSync(process.env.AUTHORIZATION_REGISTRY, 'utf8'));
const exactKeys = (value, keys) => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail();
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) fail();
};
const safeText = (value) => {
  if (typeof value !== 'string' || value === '' || /[|\r\n]/u.test(value)) fail();
  return value;
};
const validDisplayName = (value) => {
  const codePoints = [...value];
  return (
    codePoints.length >= 1 &&
    codePoints.length <= 100 &&
    value.normalize('NFC') === value &&
    !/\p{C}/u.test(value) &&
    codePoints.every((character) => character === ' ' || !/\p{White_Space}/u.test(character)) &&
    !value.startsWith(' ') &&
    !value.endsWith(' ') &&
    !value.includes('  ')
  );
};

exactKeys(registry, ['schemaVersion', 'permissions', 'systemRoles']);
if (registry.schemaVersion !== 1 || !Array.isArray(registry.permissions) || !Array.isArray(registry.systemRoles)) fail();
if (registry.permissions.length !== 7 || registry.permissions.length > 128 || registry.systemRoles.length !== 1) fail();

const permissionCodes = new Set();
const lines = [];
let previousCode = '';
for (const permission of registry.permissions) {
  exactKeys(permission, ['code', 'description']);
  const code = safeText(permission.code);
  const description = safeText(permission.description);
  if (permissionCodes.has(code) || (previousCode !== '' && previousCode >= code)) fail();
  permissionCodes.add(code);
  previousCode = code;
  lines.push(`P|${code}|${Buffer.from(description, 'utf8').toString('hex').toUpperCase()}`);
}

for (const role of registry.systemRoles) {
  exactKeys(role, [
    'id',
    'code',
    'displayName',
    'status',
    'version',
    'createdAt',
    'updatedAt',
    'retiredAt',
    'permissions',
  ]);
  const id = safeText(role.id);
  const code = safeText(role.code);
  const displayName = safeText(role.displayName);
  const status = safeText(role.status);
  const createdAt = safeText(role.createdAt);
  const updatedAt = safeText(role.updatedAt);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(id)) fail();
  if (!validDisplayName(displayName)) fail();
  if (status !== 'ACTIVE' || role.version !== 1 || updatedAt !== createdAt || role.retiredAt !== null) fail();
  if (!Array.isArray(role.permissions) || role.permissions.length !== permissionCodes.size) fail();
  let previousPermission = '';
  for (const permission of role.permissions) {
    if (!permissionCodes.has(permission) || (previousPermission !== '' && previousPermission >= permission)) fail();
    previousPermission = permission;
  }
  const compactId = id.replaceAll('-', '');
  const displayNameHex = Buffer.from(displayName, 'utf8').toString('hex').toUpperCase();
  lines.push(
    `R|${compactId}|${code}|${displayNameHex}|${status}|${role.version}|${createdAt}|${updatedAt}|NULL`,
  );
  for (const permission of role.permissions) lines.push(`M|${compactId}|${permission}`);
}

process.stdout.write(lines.join('\n'));
NODE
})"

trap cleanup_authorization_databases EXIT
reset_authorization_databases

DATABASE_HOST='127.0.0.1' \
  DATABASE_MIGRATION_URL='' \
  DATABASE_NAME="$authorization_test_database" \
  DATABASE_PORT="$authorization_mysql_port" \
  pnpm db:migrate:deploy

# The second deployment must be a successful no-op and must not replay seeds.
DATABASE_HOST='127.0.0.1' \
  DATABASE_MIGRATION_URL='' \
  DATABASE_NAME="$authorization_test_database" \
  DATABASE_PORT="$authorization_mysql_port" \
  pnpm db:migrate:deploy

authorization_shadow_database_url="$(resolve_shadow_database_url)"
DATABASE_HOST='127.0.0.1' \
  DATABASE_MIGRATION_URL='' \
  DATABASE_NAME="$authorization_test_database" \
  DATABASE_PORT="$authorization_mysql_port" \
  DATABASE_SHADOW_URL="$authorization_shadow_database_url" \
  pnpm --filter @oms/database exec prisma migrate diff \
    --config prisma.config.ts \
    --from-migrations prisma/migrations \
    --to-schema prisma \
    --exit-code
unset authorization_shadow_database_url

assert_sql_output '1|1|0' <<'SQL'
SELECT CONCAT(
    COUNT(*),
    _ascii'|',
    SUM(`finished_at` IS NOT NULL),
    _ascii'|',
    SUM(`rolled_back_at` IS NOT NULL)
)
FROM `_prisma_migrations`
WHERE `migration_name` = _ascii'20260823213000_create_identity_authorization_audit';
SQL

assert_sql_output '5|5|5' <<'SQL'
SELECT CONCAT(
    COUNT(*),
    _ascii'|',
    SUM(`ENGINE` = _ascii'InnoDB'),
    _ascii'|',
    SUM(`TABLE_COLLATION` = _ascii'utf8mb4_0900_ai_ci')
)
FROM `information_schema`.`TABLES`
WHERE `TABLE_SCHEMA` = DATABASE()
  AND `TABLE_NAME` IN (
      _ascii'identity_permissions',
      _ascii'identity_roles',
      _ascii'identity_role_permissions',
      _ascii'identity_account_roles',
      _ascii'identity_security_events'
  );
SQL

# Every column is recognized exactly once; COUNT prevents an expected subset
# from hiding an extra or reordered column.
assert_sql_output '27|27|27' <<'SQL'
SELECT CONCAT(
    COUNT(*),
    _ascii'|',
    SUM(
        (`TABLE_NAME` = _ascii'identity_permissions' AND `ORDINAL_POSITION` = 1 AND `COLUMN_NAME` = _ascii'code' AND `COLUMN_TYPE` = _ascii'varchar(98)' AND `IS_NULLABLE` = _ascii'NO' AND `COLUMN_DEFAULT` IS NULL AND `CHARACTER_SET_NAME` = _ascii'ascii' AND `COLLATION_NAME` = _ascii'ascii_bin' AND `EXTRA` = _ascii'')
        OR (`TABLE_NAME` = _ascii'identity_permissions' AND `ORDINAL_POSITION` = 2 AND `COLUMN_NAME` = _ascii'description' AND `COLUMN_TYPE` = _ascii'varchar(160)' AND `IS_NULLABLE` = _ascii'NO' AND `COLUMN_DEFAULT` IS NULL AND `CHARACTER_SET_NAME` = _ascii'utf8mb4' AND `COLLATION_NAME` = _ascii'utf8mb4_0900_as_cs' AND `EXTRA` = _ascii'')
        OR (`TABLE_NAME` = _ascii'identity_roles' AND `ORDINAL_POSITION` = 1 AND `COLUMN_NAME` = _ascii'id' AND `COLUMN_TYPE` = _ascii'binary(16)' AND `IS_NULLABLE` = _ascii'NO' AND `COLUMN_DEFAULT` IS NULL)
        OR (`TABLE_NAME` = _ascii'identity_roles' AND `ORDINAL_POSITION` = 2 AND `COLUMN_NAME` = _ascii'code' AND `COLUMN_TYPE` = _ascii'varchar(64)' AND `IS_NULLABLE` = _ascii'NO' AND `COLUMN_DEFAULT` IS NULL AND `COLLATION_NAME` = _ascii'ascii_bin')
        OR (`TABLE_NAME` = _ascii'identity_roles' AND `ORDINAL_POSITION` = 3 AND `COLUMN_NAME` = _ascii'display_name' AND `COLUMN_TYPE` = _ascii'varchar(100)' AND `IS_NULLABLE` = _ascii'NO' AND `COLUMN_DEFAULT` IS NULL AND `COLLATION_NAME` = _ascii'utf8mb4_0900_as_cs')
        OR (`TABLE_NAME` = _ascii'identity_roles' AND `ORDINAL_POSITION` = 4 AND `COLUMN_NAME` = _ascii'status' AND `COLUMN_TYPE` = _ascii'varchar(16)' AND `IS_NULLABLE` = _ascii'NO' AND `COLUMN_DEFAULT` IS NULL AND `COLLATION_NAME` = _ascii'ascii_bin')
        OR (`TABLE_NAME` = _ascii'identity_roles' AND `ORDINAL_POSITION` = 5 AND `COLUMN_NAME` = _ascii'version' AND `COLUMN_TYPE` = _ascii'int unsigned' AND `IS_NULLABLE` = _ascii'NO' AND `COLUMN_DEFAULT` = _ascii'1')
        OR (`TABLE_NAME` = _ascii'identity_roles' AND `ORDINAL_POSITION` = 6 AND `COLUMN_NAME` = _ascii'created_at' AND `COLUMN_TYPE` = _ascii'datetime(6)' AND `IS_NULLABLE` = _ascii'NO' AND `COLUMN_DEFAULT` IS NULL)
        OR (`TABLE_NAME` = _ascii'identity_roles' AND `ORDINAL_POSITION` = 7 AND `COLUMN_NAME` = _ascii'updated_at' AND `COLUMN_TYPE` = _ascii'datetime(6)' AND `IS_NULLABLE` = _ascii'NO' AND `COLUMN_DEFAULT` IS NULL)
        OR (`TABLE_NAME` = _ascii'identity_roles' AND `ORDINAL_POSITION` = 8 AND `COLUMN_NAME` = _ascii'retired_at' AND `COLUMN_TYPE` = _ascii'datetime(6)' AND `IS_NULLABLE` = _ascii'YES' AND `COLUMN_DEFAULT` IS NULL)
        OR (`TABLE_NAME` = _ascii'identity_role_permissions' AND `ORDINAL_POSITION` = 1 AND `COLUMN_NAME` = _ascii'role_id' AND `COLUMN_TYPE` = _ascii'binary(16)' AND `IS_NULLABLE` = _ascii'NO' AND `COLUMN_DEFAULT` IS NULL)
        OR (`TABLE_NAME` = _ascii'identity_role_permissions' AND `ORDINAL_POSITION` = 2 AND `COLUMN_NAME` = _ascii'permission_code' AND `COLUMN_TYPE` = _ascii'varchar(98)' AND `IS_NULLABLE` = _ascii'NO' AND `COLUMN_DEFAULT` IS NULL AND `COLLATION_NAME` = _ascii'ascii_bin')
        OR (`TABLE_NAME` = _ascii'identity_account_roles' AND `ORDINAL_POSITION` = 1 AND `COLUMN_NAME` = _ascii'account_id' AND `COLUMN_TYPE` = _ascii'binary(16)' AND `IS_NULLABLE` = _ascii'NO' AND `COLUMN_DEFAULT` IS NULL)
        OR (`TABLE_NAME` = _ascii'identity_account_roles' AND `ORDINAL_POSITION` = 2 AND `COLUMN_NAME` = _ascii'role_id' AND `COLUMN_TYPE` = _ascii'binary(16)' AND `IS_NULLABLE` = _ascii'NO' AND `COLUMN_DEFAULT` IS NULL)
        OR (`TABLE_NAME` = _ascii'identity_security_events' AND `ORDINAL_POSITION` = 1 AND `COLUMN_NAME` = _ascii'id' AND `COLUMN_TYPE` = _ascii'binary(16)' AND `IS_NULLABLE` = _ascii'NO' AND `COLUMN_DEFAULT` IS NULL)
        OR (`TABLE_NAME` = _ascii'identity_security_events' AND `ORDINAL_POSITION` = 2 AND `COLUMN_NAME` = _ascii'event_type' AND `COLUMN_TYPE` = _ascii'varchar(48)' AND `IS_NULLABLE` = _ascii'NO' AND `COLUMN_DEFAULT` IS NULL AND `COLLATION_NAME` = _ascii'ascii_bin')
        OR (`TABLE_NAME` = _ascii'identity_security_events' AND `ORDINAL_POSITION` = 3 AND `COLUMN_NAME` = _ascii'outcome' AND `COLUMN_TYPE` = _ascii'varchar(16)' AND `IS_NULLABLE` = _ascii'NO' AND `COLUMN_DEFAULT` IS NULL AND `COLLATION_NAME` = _ascii'ascii_bin')
        OR (`TABLE_NAME` = _ascii'identity_security_events' AND `ORDINAL_POSITION` = 4 AND `COLUMN_NAME` = _ascii'reason_code' AND `COLUMN_TYPE` = _ascii'varchar(32)' AND `IS_NULLABLE` = _ascii'YES' AND `COLUMN_DEFAULT` IS NULL AND `COLLATION_NAME` = _ascii'ascii_bin')
        OR (`TABLE_NAME` = _ascii'identity_security_events' AND `ORDINAL_POSITION` BETWEEN 5 AND 8 AND `COLUMN_NAME` = ELT(`ORDINAL_POSITION` - 4, _ascii'actor_account_id', _ascii'subject_account_id', _ascii'role_id', _ascii'session_id') AND `COLUMN_TYPE` = _ascii'binary(16)' AND `IS_NULLABLE` = _ascii'YES' AND `COLUMN_DEFAULT` IS NULL)
        OR (`TABLE_NAME` = _ascii'identity_security_events' AND `ORDINAL_POSITION` = 9 AND `COLUMN_NAME` = _ascii'permission_code' AND `COLUMN_TYPE` = _ascii'varchar(98)' AND `IS_NULLABLE` = _ascii'YES' AND `COLUMN_DEFAULT` IS NULL AND `COLLATION_NAME` = _ascii'ascii_bin')
        OR (`TABLE_NAME` = _ascii'identity_security_events' AND `ORDINAL_POSITION` BETWEEN 10 AND 11 AND `COLUMN_NAME` = ELT(`ORDINAL_POSITION` - 9, _ascii'request_id', _ascii'correlation_id') AND `COLUMN_TYPE` = _ascii'binary(16)' AND `IS_NULLABLE` = _ascii'YES' AND `COLUMN_DEFAULT` IS NULL)
        OR (`TABLE_NAME` = _ascii'identity_security_events' AND `ORDINAL_POSITION` = 12 AND `COLUMN_NAME` = _ascii'operator_reference' AND `COLUMN_TYPE` = _ascii'varchar(128)' AND `IS_NULLABLE` = _ascii'YES' AND `COLUMN_DEFAULT` IS NULL AND `COLLATION_NAME` = _ascii'ascii_bin')
        OR (`TABLE_NAME` = _ascii'identity_security_events' AND `ORDINAL_POSITION` = 13 AND `COLUMN_NAME` = _ascii'occurred_at' AND `COLUMN_TYPE` = _ascii'datetime(6)' AND `IS_NULLABLE` = _ascii'NO' AND `COLUMN_DEFAULT` IS NULL)
    ),
    _ascii'|',
    SUM(`EXTRA` = _ascii'')
)
FROM `information_schema`.`COLUMNS`
WHERE `TABLE_SCHEMA` = DATABASE()
  AND `TABLE_NAME` IN (
      _ascii'identity_permissions',
      _ascii'identity_roles',
      _ascii'identity_role_permissions',
      _ascii'identity_account_roles',
      _ascii'identity_security_events'
  );
SQL

assert_sql_output '20|20|20|0' <<'SQL'
SELECT CONCAT(
    COUNT(*),
    _ascii'|',
    SUM(`INDEX_TYPE` = _ascii'BTREE'),
    _ascii'|',
    SUM(`IS_VISIBLE` = _ascii'YES'),
    _ascii'|',
    SUM(`SUB_PART` IS NOT NULL OR `EXPRESSION` IS NOT NULL)
)
FROM `information_schema`.`STATISTICS`
WHERE `TABLE_SCHEMA` = DATABASE()
  AND `TABLE_NAME` IN (
      _ascii'identity_permissions',
      _ascii'identity_roles',
      _ascii'identity_role_permissions',
      _ascii'identity_account_roles',
      _ascii'identity_security_events'
  );
SQL

expected_checks='ck_identity_permissions_code,ck_identity_permissions_description,ck_identity_roles_code,ck_identity_roles_display_name,ck_identity_roles_id_uuidv7,ck_identity_roles_lifecycle,ck_identity_roles_status,ck_identity_roles_timestamp_order,ck_identity_roles_version,ck_identity_security_events_actor_uuidv7,ck_identity_security_events_correlation_uuid,ck_identity_security_events_event_context,ck_identity_security_events_event_result,ck_identity_security_events_event_type,ck_identity_security_events_id_uuidv7,ck_identity_security_events_operator_reference,ck_identity_security_events_outcome,ck_identity_security_events_permission_code,ck_identity_security_events_reason_code,ck_identity_security_events_request_uuidv4,ck_identity_security_events_role_uuidv7,ck_identity_security_events_session_uuidv7,ck_identity_security_events_subject_uuidv7,ck_identity_security_events_transport_context'
assert_sql_output "24|24|$expected_checks" <<'SQL'
SET SESSION `group_concat_max_len` = 16384;
SELECT CONCAT(
    COUNT(*),
    _ascii'|',
    SUM(`tc`.`ENFORCED` = _ascii'YES'),
    _ascii'|',
    GROUP_CONCAT(`tc`.`CONSTRAINT_NAME` ORDER BY `tc`.`CONSTRAINT_NAME` SEPARATOR ',')
)
FROM `information_schema`.`TABLE_CONSTRAINTS` AS `tc`
INNER JOIN `information_schema`.`CHECK_CONSTRAINTS` AS `cc`
    ON `cc`.`CONSTRAINT_SCHEMA` = `tc`.`CONSTRAINT_SCHEMA`
   AND `cc`.`CONSTRAINT_NAME` = `tc`.`CONSTRAINT_NAME`
WHERE `tc`.`CONSTRAINT_SCHEMA` = DATABASE()
  AND `tc`.`TABLE_NAME` IN (
      _ascii'identity_permissions',
      _ascii'identity_roles',
      _ascii'identity_security_events'
  )
  AND `tc`.`CONSTRAINT_TYPE` = _ascii'CHECK';
SQL

assert_sql_output '1:code' <<'SQL'
SELECT GROUP_CONCAT(CONCAT(`SEQ_IN_INDEX`, _ascii':', `COLUMN_NAME`) ORDER BY `SEQ_IN_INDEX`)
FROM `information_schema`.`STATISTICS`
WHERE `TABLE_SCHEMA` = DATABASE()
  AND `TABLE_NAME` = _ascii'identity_roles'
  AND `INDEX_NAME` = _ascii'uq_identity_roles_code'
  AND `NON_UNIQUE` = 0;
SQL

assert_sql_output '1:role_id,2:permission_code|1:permission_code,2:role_id' <<'SQL'
SELECT CONCAT(
    GROUP_CONCAT(IF(`INDEX_NAME` = _ascii'PRIMARY', CONCAT(`SEQ_IN_INDEX`, _ascii':', `COLUMN_NAME`), NULL) ORDER BY `SEQ_IN_INDEX`),
    _ascii'|',
    GROUP_CONCAT(IF(`INDEX_NAME` = _ascii'ix_identity_role_permissions_permission_role', CONCAT(`SEQ_IN_INDEX`, _ascii':', `COLUMN_NAME`), NULL) ORDER BY `SEQ_IN_INDEX`)
)
FROM `information_schema`.`STATISTICS`
WHERE `TABLE_SCHEMA` = DATABASE()
  AND `TABLE_NAME` = _ascii'identity_role_permissions';
SQL

assert_sql_output '1:account_id,2:role_id|1:role_id,2:account_id' <<'SQL'
SELECT CONCAT(
    GROUP_CONCAT(IF(`INDEX_NAME` = _ascii'PRIMARY', CONCAT(`SEQ_IN_INDEX`, _ascii':', `COLUMN_NAME`), NULL) ORDER BY `SEQ_IN_INDEX`),
    _ascii'|',
    GROUP_CONCAT(IF(`INDEX_NAME` = _ascii'ix_identity_account_roles_role_account', CONCAT(`SEQ_IN_INDEX`, _ascii':', `COLUMN_NAME`), NULL) ORDER BY `SEQ_IN_INDEX`)
)
FROM `information_schema`.`STATISTICS`
WHERE `TABLE_SCHEMA` = DATABASE()
  AND `TABLE_NAME` = _ascii'identity_account_roles';
SQL

expected_event_indexes='ix_identity_security_events_session_time:1:session_id,ix_identity_security_events_session_time:2:occurred_at,ix_identity_security_events_session_time:3:id,ix_identity_security_events_subject_time:1:subject_account_id,ix_identity_security_events_subject_time:2:occurred_at,ix_identity_security_events_subject_time:3:id,ix_identity_security_events_time:1:occurred_at,ix_identity_security_events_time:2:id,PRIMARY:1:id'
assert_sql_output "$expected_event_indexes" <<'SQL'
SELECT GROUP_CONCAT(
    CONCAT(`INDEX_NAME`, _ascii':', `SEQ_IN_INDEX`, _ascii':', `COLUMN_NAME`)
    ORDER BY `INDEX_NAME`, `SEQ_IN_INDEX`
    SEPARATOR ','
)
FROM `information_schema`.`STATISTICS`
WHERE `TABLE_SCHEMA` = DATABASE()
  AND `TABLE_NAME` = _ascii'identity_security_events'
  AND `INDEX_TYPE` = _ascii'BTREE'
  AND `IS_VISIBLE` = _ascii'YES'
  AND `SUB_PART` IS NULL
  AND `EXPRESSION` IS NULL;
SQL

expected_foreign_keys='fk_identity_account_roles_account:identity_account_roles:1:account_id:identity_accounts:id:RESTRICT:RESTRICT,fk_identity_account_roles_role:identity_account_roles:1:role_id:identity_roles:id:RESTRICT:RESTRICT,fk_identity_role_permissions_permission:identity_role_permissions:1:permission_code:identity_permissions:code:RESTRICT:RESTRICT,fk_identity_role_permissions_role:identity_role_permissions:1:role_id:identity_roles:id:RESTRICT:RESTRICT'
assert_sql_output "$expected_foreign_keys" <<'SQL'
SET SESSION `group_concat_max_len` = 8192;
SELECT GROUP_CONCAT(
    CONCAT(
        `kcu`.`CONSTRAINT_NAME`, _ascii':', `kcu`.`TABLE_NAME`, _ascii':',
        `kcu`.`ORDINAL_POSITION`, _ascii':', `kcu`.`COLUMN_NAME`, _ascii':',
        `kcu`.`REFERENCED_TABLE_NAME`, _ascii':', `kcu`.`REFERENCED_COLUMN_NAME`,
        _ascii':', `rc`.`DELETE_RULE`, _ascii':', `rc`.`UPDATE_RULE`
    )
    ORDER BY `kcu`.`CONSTRAINT_NAME`, `kcu`.`ORDINAL_POSITION`
    SEPARATOR ','
)
FROM `information_schema`.`KEY_COLUMN_USAGE` AS `kcu`
INNER JOIN `information_schema`.`REFERENTIAL_CONSTRAINTS` AS `rc`
    ON `rc`.`CONSTRAINT_SCHEMA` = `kcu`.`CONSTRAINT_SCHEMA`
   AND `rc`.`CONSTRAINT_NAME` = `kcu`.`CONSTRAINT_NAME`
WHERE `kcu`.`CONSTRAINT_SCHEMA` = DATABASE()
  AND `kcu`.`CONSTRAINT_NAME` IN (
      _ascii'fk_identity_account_roles_account',
      _ascii'fk_identity_account_roles_role',
      _ascii'fk_identity_role_permissions_permission',
      _ascii'fk_identity_role_permissions_role'
  );
SQL

assert_sql_output '0|0|0' <<'SQL'
SELECT CONCAT(
    (
        SELECT COUNT(*)
        FROM `information_schema`.`KEY_COLUMN_USAGE`
        WHERE `CONSTRAINT_SCHEMA` = DATABASE()
          AND `TABLE_NAME` = _ascii'identity_security_events'
          AND `REFERENCED_TABLE_NAME` IS NOT NULL
    ),
    _ascii'|',
    (
        SELECT COUNT(*)
        FROM `information_schema`.`TRIGGERS`
        WHERE `TRIGGER_SCHEMA` = DATABASE()
          AND `EVENT_OBJECT_TABLE` IN (
              _ascii'identity_permissions',
              _ascii'identity_roles',
              _ascii'identity_role_permissions',
              _ascii'identity_account_roles',
              _ascii'identity_security_events'
          )
    ),
    _ascii'|',
    (
        SELECT COUNT(*)
        FROM `information_schema`.`COLUMNS`
        WHERE `TABLE_SCHEMA` = DATABASE()
          AND `TABLE_NAME` = _ascii'identity_security_events'
          AND (`DATA_TYPE` = _ascii'json' OR `COLUMN_NAME` LIKE _ascii'%metadata%')
    )
);
SQL

assert_sql_output "$authorization_registry_expected" <<'SQL'
SELECT `registry_row`
FROM (
    SELECT
        1 AS `registry_kind`,
        `code` AS `registry_sort`,
        CONCAT(_ascii'P|', `code`, _ascii'|', HEX(`description`)) AS `registry_row`
    FROM `identity_permissions`
    UNION ALL
    SELECT
        2,
        `code`,
        CONCAT(
            _ascii'R|', LOWER(HEX(`id`)), _ascii'|', `code`, _ascii'|',
            HEX(`display_name`), _ascii'|', `status`, _ascii'|', `version`, _ascii'|',
            DATE_FORMAT(`created_at`, _ascii'%Y-%m-%dT%H:%i:%s.%fZ'), _ascii'|',
            DATE_FORMAT(`updated_at`, _ascii'%Y-%m-%dT%H:%i:%s.%fZ'), _ascii'|',
            IF(
                `retired_at` IS NULL,
                _ascii'NULL',
                DATE_FORMAT(`retired_at`, _ascii'%Y-%m-%dT%H:%i:%s.%fZ')
            )
        )
    FROM `identity_roles`
    UNION ALL
    SELECT
        3,
        CONCAT(LOWER(HEX(`role_id`)), _ascii'|', `permission_code`),
        CONCAT(_ascii'M|', LOWER(HEX(`role_id`)), _ascii'|', `permission_code`)
    FROM `identity_role_permissions`
) AS `registry_rows`
ORDER BY `registry_kind`, `registry_sort`;
SQL

assert_sql_output '7|1|7|7' <<'SQL'
SELECT CONCAT(
    (SELECT COUNT(*) FROM `identity_permissions`),
    _ascii'|',
    (SELECT COUNT(*) FROM `identity_roles` WHERE `code` = _ascii'SYSTEM_ADMINISTRATOR'),
    _ascii'|',
    (SELECT COUNT(*) FROM `identity_role_permissions`),
    _ascii'|',
    (
        SELECT COUNT(*)
        FROM `identity_role_permissions` AS `mapping`
        INNER JOIN `identity_roles` AS `role` ON `role`.`id` = `mapping`.`role_id`
        WHERE `role`.`code` = _ascii'SYSTEM_ADMINISTRATOR'
    )
);
SQL

# A later permission is never implicitly granted to the built-in role.
run_root_authorization_sql "$authorization_test_database" <<'SQL'
INSERT INTO `identity_permissions` (`code`, `description`)
VALUES (_ascii'orders.orders.read', _utf8mb4'Read order administration data.');
SQL
assert_sql_output '8|7|0' <<'SQL'
SELECT CONCAT(
    (SELECT COUNT(*) FROM `identity_permissions`),
    _ascii'|',
    (SELECT COUNT(*) FROM `identity_role_permissions`),
    _ascii'|',
    (
        SELECT COUNT(*)
        FROM `identity_role_permissions`
        WHERE `permission_code` = _ascii'orders.orders.read'
    )
);
SQL
run_root_authorization_sql "$authorization_test_database" <<'SQL'
DELETE FROM `identity_permissions` WHERE `code` = _ascii'orders.orders.read';
SQL

run_root_authorization_sql "$authorization_test_database" < "$authorization_fixture"

assert_sql_output '7|3|9|2|21|1' <<'SQL'
SELECT CONCAT(
    (SELECT COUNT(*) FROM `identity_permissions`),
    _ascii'|',
    (SELECT COUNT(*) FROM `identity_roles`),
    _ascii'|',
    (SELECT COUNT(*) FROM `identity_role_permissions`),
    _ascii'|',
    (SELECT COUNT(*) FROM `identity_account_roles`),
    _ascii'|',
    (SELECT COUNT(*) FROM `identity_security_events`),
    _ascii'|',
    (
        SELECT COUNT(*)
        FROM `identity_account_roles` AS `assignment`
        INNER JOIN `identity_roles` AS `role`
            ON `role`.`id` = `assignment`.`role_id`
           AND BINARY `role`.`status` = _binary'ACTIVE'
        INNER JOIN `identity_role_permissions` AS `mapping`
            ON `mapping`.`role_id` = `role`.`id`
        WHERE `assignment`.`account_id` = UNHEX('0198dcba000070008000000000000101')
          AND `mapping`.`permission_code` = _ascii'catalog.products.read'
    )
);
SQL

assert_sql_output '19|1|1|1|1|1' <<'SQL'
SELECT CONCAT(
    COUNT(DISTINCT `event_type`),
    _ascii'|',
    SUM(BINARY `event_type` = _binary'LOGIN' AND BINARY `outcome` = _binary'SUCCEEDED'),
    _ascii'|',
    SUM(BINARY `event_type` = _binary'LOGIN' AND BINARY `outcome` = _binary'REJECTED'),
    _ascii'|',
    SUM(BINARY `event_type` = _binary'SESSION_REFRESH' AND BINARY `outcome` = _binary'SUCCEEDED'),
    _ascii'|',
    SUM(
        BINARY `event_type` = _binary'SESSION_REFRESH'
        AND BINARY `outcome` = _binary'REJECTED'
        AND BINARY `reason_code` = _binary'REFRESH_REUSE_DETECTED'
    ),
    _ascii'|',
    SUM(
        BINARY `event_type` = _binary'SESSION_FAMILY_REVOCATION'
        AND BINARY `outcome` = _binary'SUCCEEDED'
        AND BINARY `reason_code` = _binary'SESSION_LIMIT_REACHED'
    )
)
FROM `identity_security_events`;
SQL

expected_microseconds='2026-08-23T17:00:00.202020Z|2026-08-23T17:00:00.303031Z|2026-08-23T17:10:00.111111Z|2026-08-23T17:11:00.161616Z'
assert_sql_output "$expected_microseconds" <<'SQL'
SELECT CONCAT(
    DATE_FORMAT(
        (SELECT `created_at` FROM `identity_roles` WHERE `code` = _ascii'OPERATIONS_REVIEWER'),
        _ascii'%Y-%m-%dT%H:%i:%s.%fZ'
    ),
    _ascii'|',
    DATE_FORMAT(
        (SELECT `retired_at` FROM `identity_roles` WHERE `code` = _ascii'RETIRED_AUDITOR'),
        _ascii'%Y-%m-%dT%H:%i:%s.%fZ'
    ),
    _ascii'|',
    DATE_FORMAT(
        (SELECT MIN(`occurred_at`) FROM `identity_security_events`),
        _ascii'%Y-%m-%dT%H:%i:%s.%fZ'
    ),
    _ascii'|',
    DATE_FORMAT(
        (SELECT MAX(`occurred_at`) FROM `identity_security_events`),
        _ascii'%Y-%m-%dT%H:%i:%s.%fZ'
    )
);
SQL

assert_sql_rejected 'ck_identity_permissions_code' <<'SQL'
INSERT INTO `identity_permissions` VALUES (
    CONCAT(_ascii'orders.orders.read', CHAR(10)),
    _utf8mb4'Invalid line terminator.'
);
SQL

assert_sql_rejected 'ck_identity_permissions_code' <<'SQL'
INSERT INTO `identity_permissions` VALUES (
    _ascii'orders.orders.read ',
    _utf8mb4'Invalid trailing space.'
);
SQL

assert_sql_rejected 'ck_identity_permissions_code' <<'SQL'
INSERT INTO `identity_permissions` VALUES (
    _ascii'orders.abcdefghijklmnopqrstuvwxyz1234567.read',
    _utf8mb4'Invalid oversized segment.'
);
SQL

assert_sql_rejected 'ck_identity_permissions_description' <<'SQL'
INSERT INTO `identity_permissions` VALUES (
    _ascii'orders.orders.read',
    _utf8mb4'Invalid  repeated space.'
);
SQL

assert_sql_rejected 'ck_identity_roles_id_uuidv7' <<'SQL'
INSERT INTO `identity_roles` VALUES (
    UNHEX('00000000000000000000000000000100'), _ascii'INVALID_UUID',
    _utf8mb4'Invalid UUID', _ascii'ACTIVE', 1,
    '2026-08-23 18:00:00.000001', '2026-08-23 18:00:00.000001', NULL
);
SQL

assert_sql_rejected 'ck_identity_roles_code' <<'SQL'
INSERT INTO `identity_roles` VALUES (
    UNHEX('0198dcba000070008000000000000201'), CONCAT(_ascii'INVALID_CODE', CHAR(13)),
    _utf8mb4'Invalid Code', _ascii'ACTIVE', 1,
    '2026-08-23 18:00:00.000002', '2026-08-23 18:00:00.000002', NULL
);
SQL

assert_sql_rejected 'ck_identity_roles_display_name' <<'SQL'
INSERT INTO `identity_roles` VALUES (
    UNHEX('0198dcba000070008000000000000202'), _ascii'INVALID_DISPLAY',
    _utf8mb4'Invalid  Display', _ascii'ACTIVE', 1,
    '2026-08-23 18:00:00.000003', '2026-08-23 18:00:00.000003', NULL
);
SQL

assert_sql_rejected 'ck_identity_roles_lifecycle' <<'SQL'
INSERT INTO `identity_roles` VALUES (
    UNHEX('0198dcba000070008000000000000203'), _ascii'INVALID_STATUS',
    _utf8mb4'Invalid Status', _ascii'ACTIVE ', 1,
    '2026-08-23 18:00:00.000004', '2026-08-23 18:00:00.000004', NULL
);
SQL

assert_sql_rejected 'ck_identity_roles_version' <<'SQL'
INSERT INTO `identity_roles` VALUES (
    UNHEX('0198dcba000070008000000000000204'), _ascii'INVALID_VERSION',
    _utf8mb4'Invalid Version', _ascii'ACTIVE', 0,
    '2026-08-23 18:00:00.000005', '2026-08-23 18:00:00.000005', NULL
);
SQL

assert_sql_rejected 'ck_identity_roles_timestamp_order' <<'SQL'
INSERT INTO `identity_roles` VALUES (
    UNHEX('0198dcba000070008000000000000205'), _ascii'INVALID_TIME',
    _utf8mb4'Invalid Time', _ascii'ACTIVE', 2,
    '2026-08-23 18:00:00.000006', '2026-08-23 17:59:59.000006', NULL
);
SQL

assert_sql_rejected 'ck_identity_roles_lifecycle' <<'SQL'
INSERT INTO `identity_roles` VALUES (
    UNHEX('0198dcba000070008000000000000206'), _ascii'INVALID_LIFECYCLE',
    _utf8mb4'Invalid Lifecycle', _ascii'RETIRED', 2,
    '2026-08-23 18:00:00.000007', '2026-08-23 18:30:00.000007', NULL
);
SQL

assert_sql_rejected 'uq_identity_roles_code' <<'SQL'
INSERT INTO `identity_roles` VALUES (
    UNHEX('0198dcba000070008000000000000207'), _ascii'OPERATIONS_REVIEWER',
    _utf8mb4'Duplication Attempt', _ascii'ACTIVE', 1,
    '2026-08-23 18:00:00.000008', '2026-08-23 18:00:00.000008', NULL
);
SQL

assert_sql_rejected 'PRIMARY' <<'SQL'
INSERT INTO `identity_role_permissions` VALUES (
    UNHEX('0198dcba000070008000000000000102'),
    _ascii'catalog.products.read'
);
SQL

assert_sql_rejected 'fk_identity_role_permissions_role' <<'SQL'
INSERT INTO `identity_role_permissions` VALUES (
    UNHEX('0198dcba0000700080000000000002ff'),
    _ascii'catalog.products.read'
);
SQL

assert_sql_rejected 'fk_identity_role_permissions_permission' <<'SQL'
INSERT INTO `identity_role_permissions` VALUES (
    UNHEX('0198dcba000070008000000000000102'),
    _ascii'orders.orders.read'
);
SQL

assert_sql_rejected 'fk_identity_account_roles_account' <<'SQL'
INSERT INTO `identity_account_roles` VALUES (
    UNHEX('0198dcba0000700080000000000002fe'),
    UNHEX('0198dcba000070008000000000000102')
);
SQL

assert_sql_rejected 'fk_identity_account_roles_role' <<'SQL'
INSERT INTO `identity_account_roles` VALUES (
    UNHEX('0198dcba000070008000000000000101'),
    UNHEX('0198dcba0000700080000000000002fd')
);
SQL

assert_sql_rejected 'fk_identity_account_roles_account' <<'SQL'
DELETE FROM `identity_accounts`
WHERE `id` = UNHEX('0198dcba000070008000000000000101');
SQL

assert_sql_rejected 'fk_identity_role_permissions_permission' <<'SQL'
DELETE FROM `identity_permissions`
WHERE `code` = _ascii'catalog.products.read';
SQL

# Clone valid event shapes so each mutation isolates one database invariant.
assert_sql_rejected 'ck_identity_security_events_id_uuidv7' <<'SQL'
INSERT INTO `identity_security_events`
SELECT UNHEX('00000000000000000000000000000300'), `event_type`, `outcome`, `reason_code`,
       `actor_account_id`, `subject_account_id`, `role_id`, `session_id`,
       `permission_code`, `request_id`, `correlation_id`, `operator_reference`, `occurred_at`
FROM `identity_security_events`
WHERE `id` = UNHEX('0198dcba000070008000000000000113');
SQL

assert_sql_rejected 'ck_identity_security_events_event_context' <<'SQL'
INSERT INTO `identity_security_events`
SELECT UNHEX('0198dcba000070008000000000000301'), _ascii'ROLE_PERMISSION_GRANT ', `outcome`,
       `reason_code`, `actor_account_id`, `subject_account_id`, `role_id`, `session_id`,
       `permission_code`, `request_id`, `correlation_id`, `operator_reference`, `occurred_at`
FROM `identity_security_events`
WHERE `id` = UNHEX('0198dcba000070008000000000000113');
SQL

assert_sql_rejected 'ck_identity_security_events_event_result' <<'SQL'
INSERT INTO `identity_security_events`
SELECT UNHEX('0198dcba000070008000000000000302'), `event_type`, _ascii'SUCCEEDED ',
       `reason_code`, `actor_account_id`, `subject_account_id`, `role_id`, `session_id`,
       `permission_code`, `request_id`, `correlation_id`, `operator_reference`, `occurred_at`
FROM `identity_security_events`
WHERE `id` = UNHEX('0198dcba000070008000000000000113');
SQL

assert_sql_rejected 'ck_identity_security_events_event_result' <<'SQL'
INSERT INTO `identity_security_events`
SELECT UNHEX('0198dcba000070008000000000000303'), `event_type`, `outcome`,
       _ascii'PASSWORD_REBOUND', `actor_account_id`, `subject_account_id`, `role_id`,
       `session_id`, `permission_code`, `request_id`, `correlation_id`,
       `operator_reference`, `occurred_at`
FROM `identity_security_events`
WHERE `id` = UNHEX('0198dcba000070008000000000000111');
SQL

# MySQL accepts UNKNOWN CHECK results. The explicit non-null requirement in
# the rejected-refresh branch must therefore be exercised, not inferred.
assert_sql_rejected 'ck_identity_security_events_event_result' <<'SQL'
INSERT INTO `identity_security_events`
SELECT UNHEX('0198dcba00007000800000000000030e'), `event_type`, `outcome`, NULL,
       `actor_account_id`, `subject_account_id`, `role_id`, `session_id`,
       `permission_code`, `request_id`, `correlation_id`, `operator_reference`, `occurred_at`
FROM `identity_security_events`
WHERE `id` = UNHEX('0198dcba000070008000000000000116');
SQL

assert_sql_rejected 'ck_identity_security_events_actor_uuidv7' <<'SQL'
INSERT INTO `identity_security_events`
SELECT UNHEX('0198dcba000070008000000000000304'), `event_type`, `outcome`, `reason_code`,
       UNHEX('123e4567e89b42d3a456426614174000'), `subject_account_id`, `role_id`,
       `session_id`, `permission_code`, `request_id`, `correlation_id`,
       `operator_reference`, `occurred_at`
FROM `identity_security_events`
WHERE `id` = UNHEX('0198dcba000070008000000000000113');
SQL

assert_sql_rejected 'ck_identity_security_events_subject_uuidv7' <<'SQL'
INSERT INTO `identity_security_events`
SELECT UNHEX('0198dcba000070008000000000000305'), `event_type`, `outcome`, `reason_code`,
       `actor_account_id`, UNHEX('123e4567e89b42d3a456426614174000'), `role_id`,
       `session_id`, `permission_code`, `request_id`, `correlation_id`,
       `operator_reference`, `occurred_at`
FROM `identity_security_events`
WHERE `id` = UNHEX('0198dcba000070008000000000000110');
SQL

assert_sql_rejected 'ck_identity_security_events_role_uuidv7' <<'SQL'
INSERT INTO `identity_security_events`
SELECT UNHEX('0198dcba000070008000000000000306'), `event_type`, `outcome`, `reason_code`,
       `actor_account_id`, `subject_account_id`, UNHEX('123e4567e89b42d3a456426614174000'),
       `session_id`, `permission_code`, `request_id`, `correlation_id`,
       `operator_reference`, `occurred_at`
FROM `identity_security_events`
WHERE `id` = UNHEX('0198dcba000070008000000000000113');
SQL

assert_sql_rejected 'ck_identity_security_events_session_uuidv7' <<'SQL'
INSERT INTO `identity_security_events`
SELECT UNHEX('0198dcba000070008000000000000307'), `event_type`, `outcome`, `reason_code`,
       `actor_account_id`, `subject_account_id`, `role_id`,
       UNHEX('123e4567e89b42d3a456426614174000'), `permission_code`, `request_id`,
       `correlation_id`, `operator_reference`, `occurred_at`
FROM `identity_security_events`
WHERE `id` = UNHEX('0198dcba000070008000000000000112');
SQL

assert_sql_rejected 'ck_identity_security_events_request_uuidv4' <<'SQL'
INSERT INTO `identity_security_events`
SELECT UNHEX('0198dcba000070008000000000000308'), `event_type`, `outcome`, `reason_code`,
       `actor_account_id`, `subject_account_id`, `role_id`, `session_id`,
       `permission_code`, UNHEX('0198dcba000070008000000000000130'),
       `correlation_id`, `operator_reference`, `occurred_at`
FROM `identity_security_events`
WHERE `id` = UNHEX('0198dcba000070008000000000000113');
SQL

assert_sql_rejected 'ck_identity_security_events_correlation_uuid' <<'SQL'
INSERT INTO `identity_security_events`
SELECT UNHEX('0198dcba000070008000000000000309'), `event_type`, `outcome`, `reason_code`,
       `actor_account_id`, `subject_account_id`, `role_id`, `session_id`,
       `permission_code`, `request_id`, UNHEX('123e4567e89b52d3a456426614174000'),
       `operator_reference`, `occurred_at`
FROM `identity_security_events`
WHERE `id` = UNHEX('0198dcba000070008000000000000113');
SQL

assert_sql_rejected 'ck_identity_security_events_permission_code' <<'SQL'
INSERT INTO `identity_security_events`
SELECT UNHEX('0198dcba00007000800000000000030a'), `event_type`, `outcome`, `reason_code`,
       `actor_account_id`, `subject_account_id`, `role_id`, `session_id`,
       CONCAT(_ascii'orders.orders.read', CHAR(10)), `request_id`, `correlation_id`,
       `operator_reference`, `occurred_at`
FROM `identity_security_events`
WHERE `id` = UNHEX('0198dcba000070008000000000000113');
SQL

assert_sql_rejected 'ck_identity_security_events_operator_reference' <<'SQL'
INSERT INTO `identity_security_events`
SELECT UNHEX('0198dcba00007000800000000000030b'), `event_type`, `outcome`, `reason_code`,
       `actor_account_id`, `subject_account_id`, `role_id`, `session_id`,
       `permission_code`, `request_id`, `correlation_id`, _ascii'bad reference', `occurred_at`
FROM `identity_security_events`
WHERE `id` = UNHEX('0198dcba000070008000000000000110');
SQL

assert_sql_rejected 'ck_identity_security_events_transport_context' <<'SQL'
INSERT INTO `identity_security_events`
SELECT UNHEX('0198dcba00007000800000000000030c'), `event_type`, `outcome`, `reason_code`,
       `actor_account_id`, `subject_account_id`, `role_id`, `session_id`,
       `permission_code`, `request_id`, NULL, `operator_reference`, `occurred_at`
FROM `identity_security_events`
WHERE `id` = UNHEX('0198dcba000070008000000000000113');
SQL

assert_sql_rejected 'ck_identity_security_events_event_context' <<'SQL'
INSERT INTO `identity_security_events`
SELECT UNHEX('0198dcba00007000800000000000030d'), `event_type`, `outcome`, `reason_code`,
       `actor_account_id`, `subject_account_id`, `role_id`, `session_id`,
       NULL, `request_id`, `correlation_id`, `operator_reference`, `occurred_at`
FROM `identity_security_events`
WHERE `id` = UNHEX('0198dcba000070008000000000000113');
SQL

assert_sql_output '7|3|9|2|21' <<'SQL'
SELECT CONCAT(
    (SELECT COUNT(*) FROM `identity_permissions`), _ascii'|',
    (SELECT COUNT(*) FROM `identity_roles`), _ascii'|',
    (SELECT COUNT(*) FROM `identity_role_permissions`), _ascii'|',
    (SELECT COUNT(*) FROM `identity_account_roles`), _ascii'|',
    (SELECT COUNT(*) FROM `identity_security_events`)
);
SQL

printf '%s\n' 'Identity authorization and security-event migration verified against real MySQL'
